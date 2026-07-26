import {
  PROTOCOL_VERSION,
  client,
  methods,
  type ClientConnection,
  type ContentBlock,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";

import { ipc } from "@/lib/ipc/ipc";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";

import { continuationContext, newArchiveId } from "./archive";
import {
  circuitMessage,
  emptyCircuit,
  recordCrash,
  resetCircuit,
  type CircuitState,
} from "./circuit";
import { openAgentTransport, type AcpTransport } from "./stream";
import { applySessionUpdate } from "./sessionUpdates";
import type {
  AgentPermissionMode,
  AgentImageAttachment,
  AgentAvailableCommand,
  AgentConversationCost,
  AgentConversationUsage,
  AgentStartOptions,
  AgentTimelineItem,
  PermissionPrompt,
  StartableBackend,
} from "./types";

export type { StartableBackend, AgentPermissionMode, AgentStartOptions };

export interface AgentSessionHandle {
  backend: StartableBackend;
  projectPath: string;
  archiveId: string;
  createdAt: number;
  transportSessionId: number;
  acpSessionId: string | null;
  items: AgentTimelineItem[];
  permission: PermissionPrompt | null;
  status: "starting" | "running" | "busy" | "exited" | "crashed" | "error";
  error?: string;
  agentName?: string;
  /** Last stderr lines for crash diagnosis. */
  stderrTail: string[];
  /** True when the crash circuit breaker has tripped. */
  circuitOpen: boolean;
  /** Current conversation context usage reported by the harness. */
  contextUsed: number | null;
  contextSize: number | null;
  /** Harness-native slash commands advertised for this live session. */
  availableCommands: AgentAvailableCommand[];
  /** Cumulative per-conversation token usage and cost when advertised. */
  usage: AgentConversationUsage | null;
  cost: AgentConversationCost | null;
  /** ACP prompt capability advertised by the connected harness. */
  supportsImages: boolean;
}

type Listener = (session: AgentSessionHandle) => void;

const STDERR_TAIL = 12;

export interface AgentPromptOptions {
  displayText?: string;
  checkpointId?: string | null;
  images?: AgentImageAttachment[];
}

export function buildPromptBlocks(
  text: string,
  images: AgentImageAttachment[] = [],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (text.trim()) blocks.push({ type: "text", text });
  blocks.push(
    ...images.map(
      (image): ContentBlock => ({
        type: "image",
        data: image.data,
        mimeType: image.mimeType,
      }),
    ),
  );
  return blocks;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function normalizeAvailableCommands(
  commands: Array<{
    name?: unknown;
    description?: unknown;
    input?: { hint?: unknown } | null;
  }>,
): AgentAvailableCommand[] {
  const seen = new Set<string>();
  return commands.flatMap((command) => {
    if (typeof command.name !== "string") return [];
    const name = command.name.trim().replace(/^\/+/, "");
    if (!name || /\s/.test(name) || name.length > 128) return [];
    const key = name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      name,
      description:
        typeof command.description === "string"
          ? command.description.trim().slice(0, 512)
          : "",
      inputHint:
        typeof command.input?.hint === "string"
          ? command.input.hint.trim().slice(0, 256) || undefined
          : undefined,
    }];
  });
}

function collectDiagnosticStrings(
  value: unknown,
  output: string[],
  depth = 0,
) {
  if (depth > 5 || output.join("\n").length >= 64 * 1024) return;
  if (typeof value === "string") {
    if (value.trim()) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDiagnosticStrings(item, output, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["data", "oldText", "newText"].includes(key)) continue;
    collectDiagnosticStrings(child, output, depth + 1);
  }
}

export function diagnosticTextFromSessionUpdate(update: SessionUpdate): string {
  if (update.sessionUpdate !== "tool_call_update") return "";
  const output: string[] = [];
  collectDiagnosticStrings(update.rawOutput, output);
  collectDiagnosticStrings(update.content, output);
  return output.join("\n").slice(0, 64 * 1024);
}

function normalizedUsage(
  usage: {
    totalTokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    thoughtTokens?: unknown;
    cachedReadTokens?: unknown;
    cachedWriteTokens?: unknown;
  } | null | undefined,
): AgentConversationUsage | null {
  const totalTokens = finiteNonNegative(usage?.totalTokens);
  const inputTokens = finiteNonNegative(usage?.inputTokens);
  const outputTokens = finiteNonNegative(usage?.outputTokens);
  if (totalTokens === null || inputTokens === null || outputTokens === null) return null;
  const optional = (value: unknown) => finiteNonNegative(value) ?? undefined;
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    thoughtTokens: optional(usage?.thoughtTokens),
    cachedReadTokens: optional(usage?.cachedReadTokens),
    cachedWriteTokens: optional(usage?.cachedWriteTokens),
  };
}

function normalizedCost(
  cost: { amount?: unknown; currency?: unknown } | null | undefined,
): AgentConversationCost | null {
  const amount = finiteNonNegative(cost?.amount);
  if (amount === null || typeof cost?.currency !== "string") return null;
  const currency = cost.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency };
}

function modeIdFor(mode: AgentPermissionMode): string {
  if (mode === "safe") return "request-approval";
  if (mode === "unleashed") return "full-access";
  return "auto-approval";
}

/**
 * AgentBus — owns ACP client lifecycle for one live agent subprocess.
 * UI consumes timeline items + permission prompts via subscribe().
 */
export class AgentBus {
  private handle: AgentSessionHandle | null = null;
  private transport: AcpTransport | null = null;
  private connection: ClientConnection | null = null;
  private listeners = new Set<Listener>();
  private permissionWaiters = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();
  private unsubStderr: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private stderrTail: string[] = [];
  private circuit: CircuitState = emptyCircuit();
  private configuredModel: string | null = null;
  private configuredReasoningEffort: string | null = null;
  private configuredFastMode = false;
  private configuredMode: AgentPermissionMode = "standard";
  private continuationContextPending: string | null = null;
  private ignoreSessionUpdates = false;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    if (this.handle) listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSession() {
    return this.handle ? this.snapshot() : null;
  }

  isCircuitOpen() {
    return this.circuit.open;
  }

  getCircuit() {
    return { ...this.circuit, crashTimes: [...this.circuit.crashTimes] };
  }

  /** Clear the crash circuit so the user can attempt another start. */
  clearCircuit() {
    this.circuit = resetCircuit();
    if (this.handle) {
      this.handle.circuitOpen = false;
      if (this.handle.error?.startsWith("Circuit open:")) {
        this.handle.error = undefined;
      }
      this.emit();
    }
  }

  private snapshot(): AgentSessionHandle {
    if (!this.handle) throw new Error("no session");
    return {
      ...this.handle,
      items: [...this.handle.items],
      permission: this.handle.permission ? { ...this.handle.permission } : null,
      stderrTail: [...this.handle.stderrTail],
      availableCommands: [...this.handle.availableCommands],
      usage: this.handle.usage ? { ...this.handle.usage } : null,
      cost: this.handle.cost ? { ...this.handle.cost } : null,
      circuitOpen: this.circuit.open,
    };
  }

  private emit() {
    if (!this.handle) return;
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private pushSystem(text: string, note?: "config" | "alert") {
    if (!this.handle) return;
    this.handle.items = [
      ...this.handle.items,
      {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "system",
        text,
        note,
        at: Date.now(),
      },
    ];
    this.emit();
  }

  async start(backend: StartableBackend, cwd: string, options: AgentStartOptions = {}) {
    if (this.circuit.open) {
      throw new Error(circuitMessage(this.circuit) ?? "Circuit open");
    }

    await this.stop();

    const mode: AgentPermissionMode = options.mode ?? "standard";
    const configuredModel = options.model ?? options.harness?.model ?? null;
    this.stderrTail = [];
    this.configuredModel = configuredModel;
    this.configuredReasoningEffort = options.reasoningEffort ?? null;
    this.configuredFastMode = options.fastMode ?? false;
    this.configuredMode = mode;

    const restore = options.restore;
    this.continuationContextPending = null;
    this.handle = {
      backend,
      projectPath: cwd,
      archiveId: restore?.archiveId ?? newArchiveId(),
      createdAt: restore?.createdAt ?? Date.now(),
      transportSessionId: 0,
      acpSessionId: restore?.acpSessionId ?? null,
      items: restore ? [...restore.items] : [],
      permission: null,
      status: "starting",
      stderrTail: [],
      circuitOpen: false,
      contextUsed: null,
      contextSize: options.contextWindow ?? null,
      availableCommands: [],
      usage: restore?.usage ? { ...restore.usage } : null,
      cost: restore?.cost ? { ...restore.cost } : null,
      supportsImages: false,
    };
    this.emit();

    const transport = await openAgentTransport({
      backend,
      cwd,
      protocol: options.harness?.protocol ?? null,
      command: options.harness?.command ?? null,
      args: options.harness?.args ?? [],
      env: options.harness?.env ?? {},
      endpoint: options.harness?.endpoint ?? null,
      model: configuredModel,
      reasoningEffort: options.reasoningEffort ?? null,
      contextWindow: options.contextWindow ?? null,
      fastMode: options.fastMode ?? false,
      approvalReviewer: options.approvalReviewer ?? "user",
      prewarmedSessionId: options.prewarmedSessionId ?? null,
      providerId: options.providerId ?? null,
      mode,
    });
    this.transport = transport;
    this.handle.transportSessionId = transport.sessionId;

    this.unsubStderr = transport.onStderr((line) => {
      this.stderrTail = [...this.stderrTail.slice(-(STDERR_TAIL - 1)), line];
      if (this.handle) this.handle.stderrTail = [...this.stderrTail];
      // Keep stderr out of the main chat stream — surface on crash banner instead.
      this.emit();
    });
    this.unsubExit = transport.onExit((code) => {
      if (!this.handle) return;
      const wasBusy =
        this.handle.status === "busy" || this.handle.status === "starting";
      this.handle.status = wasBusy ? "crashed" : "exited";
      this.handle.stderrTail = [...this.stderrTail];
      if (wasBusy) {
        this.circuit = recordCrash(this.circuit);
        this.handle.circuitOpen = this.circuit.open;
        const trip = circuitMessage(this.circuit);
        this.pushSystem(
          trip
            ? `Agent crashed (exit ${code}). ${trip}`
            : `Agent crashed (exit ${code}). Restart or browse past sessions.`,
          "alert",
        );
        if (trip) this.handle.error = trip;
      } else {
        this.pushSystem(`Agent exited (${code})`, "alert");
      }
      this.connection = null;
    });

    const connection = client({ name: "glyphra" })
      .onRequest(methods.client.session.requestPermission, async (ctx) =>
        this.handlePermission(ctx.params),
      )
      .onRequest(methods.client.fs.readTextFile, async (ctx) => {
        const file = await ipc.fsRead(ctx.params.path);
        return { content: file.content };
      })
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        await ipc.fsWrite(ctx.params.path, ctx.params.content);
        return {};
      })
      .onRequest(methods.client.terminal.create, async (ctx) => {
        const terminalId = await ipc.agentTermCreate({
          command: ctx.params.command,
          args: ctx.params.args ?? [],
          cwd: ctx.params.cwd ?? this.handle?.projectPath ?? null,
          env: (ctx.params.env ?? []).map((item) => ({
            name: item.name,
            value: item.value,
          })),
          outputByteLimit: ctx.params.outputByteLimit ?? null,
        });
        return { terminalId };
      })
      .onRequest(methods.client.terminal.output, async (ctx) => {
        const result = await ipc.agentTermOutput(ctx.params.terminalId);
        return {
          output: result.output,
          truncated: result.truncated,
          exitStatus:
            result.exitCode == null && result.signal == null
              ? null
              : { exitCode: result.exitCode, signal: result.signal },
        };
      })
      .onRequest(methods.client.terminal.waitForExit, async (ctx) => {
        const result = await ipc.agentTermWait(ctx.params.terminalId);
        return { exitCode: result.exitCode, signal: result.signal };
      })
      .onRequest(methods.client.terminal.kill, async (ctx) => {
        await ipc.agentTermKill(ctx.params.terminalId);
        return {};
      })
      .onRequest(methods.client.terminal.release, async (ctx) => {
        await ipc.agentTermRelease(ctx.params.terminalId);
        return {};
      })
      .onNotification(methods.client.session.update, (ctx) => {
        if (this.ignoreSessionUpdates) return;
        const update = ctx.params.update;
        if (!this.handle) return;
        // Agents may publish initial commands while session/new is still
        // resolving. Bind the first update to the single starting session so
        // those capabilities are not lost before buildSession().start().
        if (
          this.handle.acpSessionId === null
          && this.handle.status === "starting"
        ) {
          this.handle.acpSessionId = ctx.params.sessionId;
        }
        if (this.handle.acpSessionId !== ctx.params.sessionId) return;
        if (update.sessionUpdate === "usage_update") {
          this.handle.contextUsed = update.used;
          this.handle.contextSize = update.size;
          const cost = normalizedCost(update.cost);
          if (cost) this.handle.cost = cost;
        } else if (update.sessionUpdate === "available_commands_update") {
          this.handle.availableCommands = normalizeAvailableCommands(
            update.availableCommands,
          );
        } else {
          this.handle.items = applySessionUpdate(this.handle.items, update);
          const diagnosticText = diagnosticTextFromSessionUpdate(update);
          if (diagnosticText) {
            useDiagnosticsStore
              .getState()
              .ingestText("agent", diagnosticText, this.handle.projectPath);
          }
        }
        this.emit();
      })
      .connect(transport.stream);

    this.connection = connection;

    try {
      const init = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          session: { configOptions: {} },
        },
        clientInfo: {
          name: "glyphra",
          title: "Glyphra",
          version: "0.1.0",
        },
      });

      this.handle.agentName = init.agentInfo?.title ?? init.agentInfo?.name;
      this.handle.supportsImages =
        init.agentCapabilities?.promptCapabilities?.image === true;
      this.pushSystem(
        `Connected${this.handle.agentName ? ` to ${this.handle.agentName}` : ""} · ${options.harness?.protocol ?? "ACP"}`,
      );

      const authMethods = init.authMethods ?? [];
      if (authMethods.length > 0) {
        const methodId = authMethods[0]?.id;
        if (methodId) {
          try {
            await connection.agent.request(methods.agent.authenticate, { methodId });
            this.pushSystem(`Authenticated via ${methodId}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const hint =
              backend === "codex-acp"
                ? " Run `codex` in a terminal to log in, or add an API provider in Settings."
                : backend === "claude-acp"
                  ? " Run `claude` to log in, or add an Anthropic key in Settings."
                  : "";
            throw new Error(`Authentication failed (${methodId}): ${message}.${hint}`);
          }
        }
      }

      const restoreSessionId = restore?.acpSessionId;
      const mcpServers: McpServer[] = options.mcpServers ?? [];
      if (restoreSessionId) {
        const capabilities = init.agentCapabilities;
        let restoredNatively = false;
        if (capabilities?.sessionCapabilities?.resume) {
          try {
            await connection.agent.request(methods.agent.session.resume, {
              sessionId: restoreSessionId,
              cwd,
              mcpServers,
            });
            this.handle.acpSessionId = restoreSessionId;
            restoredNatively = true;
            this.pushSystem("Previous session resumed");
          } catch (error) {
            this.pushSystem(
              `Native session resume was unavailable (${error instanceof Error ? error.message : String(error)})`,
            );
          }
        } else if (capabilities?.loadSession) {
          // The local JSONL archive already owns the rendered timeline. Suppress
          // history replay during session/load so messages are not duplicated.
          this.ignoreSessionUpdates = true;
          try {
            await connection.agent.request(methods.agent.session.load, {
              sessionId: restoreSessionId,
              cwd,
              mcpServers,
            });
            this.handle.acpSessionId = restoreSessionId;
            restoredNatively = true;
            this.pushSystem("Previous session loaded");
          } catch (error) {
            this.pushSystem(
              `Native session load was unavailable (${error instanceof Error ? error.message : String(error)})`,
            );
          } finally {
            this.ignoreSessionUpdates = false;
          }
        }
        if (!restoredNatively) {
          const active = await connection.agent
            .buildSession({ cwd, mcpServers })
            .start();
          this.handle.acpSessionId = active.sessionId;
          active.dispose();
          this.continuationContextPending = continuationContext(restore.items);
          this.pushSystem("Continued in a new agent process with the previous conversation context");
        }
      } else {
        const active = await connection.agent
          .buildSession({ cwd, mcpServers })
          .start();
        this.handle.acpSessionId = active.sessionId;
        active.dispose();
        if (restore) {
          this.continuationContextPending = continuationContext(restore.items);
          this.pushSystem("Continued in a new agent process with the previous conversation context");
        }
      }

      const modeId = modeIdFor(mode);
      try {
        await connection.agent.request(methods.agent.session.setMode, {
          sessionId: this.handle.acpSessionId,
          modeId,
        });
        this.pushSystem(`Mode: ${mode} (${modeId})`);
      } catch (error) {
        if (options.harness?.protocol === "codex-app-server") throw error;
        this.pushSystem(`Mode preset: ${mode} (agent set_mode unavailable)`);
      }

      if (options.providerId) {
        this.pushSystem(
          `Provider: ${options.providerId.slice(0, 8)}… (env injected at spawn)`,
          "config",
        );
      }
      if (options.model) {
        const details = [
          options.model,
          options.reasoningEffort ? `effort ${options.reasoningEffort}` : null,
          options.contextWindow ? `context ${Math.round(options.contextWindow / 1024)}K` : null,
          options.approvalReviewer === "auto_review" ? "auto-review" : null,
        ].filter(Boolean);
        this.pushSystem(`Model: ${details.join(" · ")}`);
      }

      this.handle.status = "running";
      this.emit();
      return this.snapshot();
    } catch (error) {
      this.handle.status = "error";
      this.handle.error = error instanceof Error ? error.message : String(error);
      this.handle.stderrTail = [...this.stderrTail];
      this.emit();
      const message = this.handle.error;
      await this.stop();
      throw new Error(message);
    }
  }

  async configure(config: {
    model: string | null;
    reasoningEffort: string | null;
    fastMode?: boolean;
    mode?: AgentPermissionMode;
  }) {
    if (!this.connection || !this.handle?.acpSessionId) {
      throw new Error("No running agent session");
    }
    if (this.handle.status === "busy") {
      throw new Error("Finish or cancel the current turn before changing model settings");
    }

    const sessionId = this.handle.acpSessionId;
    const changed: string[] = [];
    if (config.mode && config.mode !== this.configuredMode) {
      await this.connection.agent.request(methods.agent.session.setMode, {
        sessionId,
        modeId: modeIdFor(config.mode),
      });
      this.configuredMode = config.mode;
      changed.push(`permissions ${modeIdFor(config.mode)}`);
    }
    if (config.model !== this.configuredModel) {
      await this.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "model",
        value: config.model ?? "",
      });
      this.configuredModel = config.model;
      changed.push(config.model ? `model ${config.model}` : "default model");
    }
    if (config.reasoningEffort !== this.configuredReasoningEffort) {
      await this.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "reasoning_effort",
        value: config.reasoningEffort ?? "",
      });
      this.configuredReasoningEffort = config.reasoningEffort;
      changed.push(
        config.reasoningEffort
          ? `effort ${config.reasoningEffort}`
          : "default reasoning effort",
      );
    }
    if (
      typeof config.fastMode === "boolean" &&
      config.fastMode !== this.configuredFastMode
    ) {
      await this.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "fast_mode",
        type: "boolean",
        value: config.fastMode,
      });
      this.configuredFastMode = config.fastMode;
      changed.push(config.fastMode ? "fast mode" : "standard speed");
    }
    if (changed.length > 0) this.pushSystem(`Next turn: ${changed.join(" · ")}`, "config");
  }

  async prompt(text: string, options: AgentPromptOptions = {}) {
    if (
      !this.handle ||
      !this.connection ||
      !this.handle.acpSessionId ||
      this.handle.status === "exited" ||
      this.handle.status === "crashed"
    ) {
      throw new Error("No running agent session — start or restart first");
    }
    if (this.handle.status === "busy") {
      throw new Error("Agent is already answering — cancel the turn first");
    }
    const images = options.images ?? [];
    if (images.length > 0 && !this.handle.supportsImages) {
      throw new Error("The connected agent does not advertise ACP image input support");
    }

    this.handle.items = [
      ...this.handle.items,
      {
        id: `user-${Date.now()}`,
        kind: "user",
        text: options.displayText?.trim() || text,
        promptText: options.displayText?.trim() === text ? undefined : text,
        checkpointId: options.checkpointId ?? undefined,
        images: images.length > 0 ? images : undefined,
        at: Date.now(),
      },
    ];
    this.handle.status = "busy";
    this.emit();

    const handoff = this.continuationContextPending;
    this.continuationContextPending = null;
    try {
      const promptText = handoff ? `${handoff}\n\n<new_user_message>\n${text}\n</new_user_message>` : text;
      const response = await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId: this.handle.acpSessionId,
        prompt: buildPromptBlocks(promptText, images),
      });
      const usage = normalizedUsage(response.usage);
      if (usage) this.handle.usage = usage;
      const context = response._meta?.glyphraContext as
        | { used?: unknown; size?: unknown }
        | undefined;
      if (
        typeof context?.used === "number" &&
        typeof context?.size === "number" &&
        context.size > 0
      ) {
        this.handle.contextUsed = context.used;
        this.handle.contextSize = context.size;
      }
      this.handle.status = "running";
      this.pushSystem(`Turn complete (${response.stopReason})`);
    } catch (error) {
      // Preserve the context handoff for a retry if the first continued prompt failed.
      if (handoff && this.continuationContextPending === null) this.continuationContextPending = handoff;
      // onExit may have already flipped status to crashed/exited.
      if (this.handle?.status === "busy" || this.handle?.status === "running") {
        this.handle.status = "error";
        this.handle.error = error instanceof Error ? error.message : String(error);
        this.emit();
      }
      throw error;
    }
  }

  respondPermission(optionId: string | "cancelled") {
    const permission = this.handle?.permission;
    if (!permission) return;
    const waiter = this.permissionWaiters.get(permission.id);
    if (!waiter) return;

    const response: RequestPermissionResponse =
      optionId === "cancelled"
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId } };

    waiter(response);
    this.permissionWaiters.delete(permission.id);
    if (this.handle) {
      this.handle.permission = null;
      this.emit();
    }
  }

  /** Cancel the in-flight prompt turn (ACP `session/cancel`). */
  async cancel() {
    if (!this.handle?.acpSessionId || !this.connection) return;
    if (this.handle.permission) {
      this.respondPermission("cancelled");
    }
    try {
      await this.connection.agent.notify(methods.agent.session.cancel, {
        sessionId: this.handle.acpSessionId,
      });
      this.pushSystem("Turn cancelled");
    } catch (error) {
      this.pushSystem(
        `Cancel failed: ${error instanceof Error ? error.message : String(error)}`,
        "alert",
      );
    }
  }

  private handlePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const id = `perm-${Date.now()}`;
    return new Promise((resolve) => {
      this.permissionWaiters.set(id, resolve);
      if (this.handle) {
        const locations =
          params.toolCall.locations
            ?.map((loc) => loc.path)
            .filter(Boolean) ?? [];
        this.handle.permission = {
          id,
          title: params.toolCall.title ?? "Permission required",
          toolCallId: params.toolCall.toolCallId,
          kind: params.toolCall.kind != null ? String(params.toolCall.kind) : undefined,
          locations,
          options: params.options.map((option) => ({
            optionId: option.optionId,
            name: option.name,
            kind: option.kind,
          })),
        };
        this.emit();
      }
    });
  }

  async stop() {
    for (const [, waiter] of this.permissionWaiters) {
      waiter({ outcome: { outcome: "cancelled" } });
    }
    this.permissionWaiters.clear();

    try {
      this.connection?.close();
    } catch {
      // ignore
    }
    this.connection = null;

    this.unsubStderr?.();
    this.unsubExit?.();
    this.unsubStderr = null;
    this.unsubExit = null;

    if (this.transport) {
      try {
        await this.transport.kill();
      } catch {
        // process may already be gone
      }
    }
    this.transport = null;
    this.configuredModel = null;
    this.configuredReasoningEffort = null;
    this.configuredFastMode = false;
    this.continuationContextPending = null;
    this.ignoreSessionUpdates = false;

    if (this.handle) {
      this.handle = {
        ...this.handle,
        status: "exited",
        permission: null,
        stderrTail: [...this.stderrTail],
        circuitOpen: this.circuit.open,
      };
      this.emit();
    }
    this.handle = null;
  }
}

export const agentBus = new AgentBus();

/** @deprecated Use AgentTimelineItem */
export type AgentBusMessage = AgentTimelineItem;
