import {
  PROTOCOL_VERSION,
  client,
  methods,
  type ActiveSession,
  type ClientConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

import { ipc } from "@/lib/ipc/ipc";

import { newArchiveId } from "./archive";
import { openAgentTransport, type AcpTransport } from "./stream";
import { applySessionUpdate } from "./sessionUpdates";
import type {
  AgentPermissionMode,
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
}

type Listener = (session: AgentSessionHandle) => void;

const STDERR_TAIL = 12;

function modeIdFor(mode: AgentPermissionMode): string {
  // Align with supervisor INITIAL_AGENT_MODE / Codex-style ids.
  if (mode === "safe") return "read-only";
  if (mode === "unleashed") return "agent-full-access";
  return "agent";
}

/**
 * AgentBus — owns ACP client lifecycle for one live agent subprocess.
 * UI consumes timeline items + permission prompts via subscribe().
 */
export class AgentBus {
  private handle: AgentSessionHandle | null = null;
  private transport: AcpTransport | null = null;
  private connection: ClientConnection | null = null;
  private active: ActiveSession | null = null;
  private listeners = new Set<Listener>();
  private permissionWaiters = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();
  private unsubStderr: (() => void) | null = null;
  private unsubExit: (() => void) | null = null;
  private stderrTail: string[] = [];

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

  private snapshot(): AgentSessionHandle {
    if (!this.handle) throw new Error("no session");
    return {
      ...this.handle,
      items: [...this.handle.items],
      permission: this.handle.permission ? { ...this.handle.permission } : null,
      stderrTail: [...this.handle.stderrTail],
    };
  }

  private emit() {
    if (!this.handle) return;
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private pushSystem(text: string) {
    if (!this.handle) return;
    this.handle.items = [
      ...this.handle.items,
      { id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: "system", text, at: Date.now() },
    ];
    this.emit();
  }

  async start(backend: StartableBackend, cwd: string, options: AgentStartOptions = {}) {
    await this.stop();

    const mode: AgentPermissionMode = options.mode ?? "standard";
    this.stderrTail = [];

    this.handle = {
      backend,
      projectPath: cwd,
      archiveId: newArchiveId(),
      createdAt: Date.now(),
      transportSessionId: 0,
      acpSessionId: null,
      items: [],
      permission: null,
      status: "starting",
      stderrTail: [],
    };
    this.emit();

    const transport = await openAgentTransport({
      backend,
      cwd,
      command: null,
      args: [],
      env: {},
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
      this.pushSystem(
        wasBusy
          ? `Agent crashed (exit ${code}). Restart or browse past sessions.`
          : `Agent exited (${code})`,
      );
      this.active = null;
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
      .connect(transport.stream);

    this.connection = connection;

    try {
      const init = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: {
          name: "glyphra",
          title: "Glyphra",
          version: "0.1.0",
        },
      });

      this.handle.agentName = init.agentInfo?.title ?? init.agentInfo?.name;
      this.pushSystem(
        `Connected${this.handle.agentName ? ` to ${this.handle.agentName}` : ""} · ${backend}`,
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

      const active = await connection.agent.buildSession(cwd).start();
      this.active = active;
      this.handle.acpSessionId = active.sessionId;

      const modeId = modeIdFor(mode);
      try {
        await connection.agent.request(methods.agent.session.setMode, {
          sessionId: active.sessionId,
          modeId,
        });
        this.pushSystem(`Mode: ${mode} (${modeId})`);
      } catch {
        this.pushSystem(`Mode preset: ${mode} (agent set_mode unavailable)`);
      }

      if (options.providerId) {
        this.pushSystem(`Provider: ${options.providerId.slice(0, 8)}… (env injected at spawn)`);
      } else if (backend !== "fixture") {
        this.pushSystem("Provider: CLI login / defaults (no Glyphra key selected)");
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

  async prompt(text: string) {
    if (
      !this.handle ||
      !this.active ||
      this.handle.status === "exited" ||
      this.handle.status === "crashed"
    ) {
      throw new Error("No running agent session — start or restart first");
    }
    if (this.handle.status === "busy") {
      throw new Error("Agent is already answering — cancel the turn first");
    }

    this.handle.items = [
      ...this.handle.items,
      { id: `user-${Date.now()}`, kind: "user", text, at: Date.now() },
    ];
    this.handle.status = "busy";
    this.emit();

    const active = this.active;
    const promptPromise = active.prompt(text);

    try {
      for (;;) {
        const message = await active.nextUpdate();
        if (message.kind === "stop") {
          this.handle.status = "running";
          this.pushSystem(`Turn complete (${message.stopReason})`);
          await promptPromise;
          return;
        }
        this.handle.items = applySessionUpdate(this.handle.items, message.update);
        this.emit();
      }
    } catch (error) {
      // onExit may have already flipped status to crashed/exited.
      if (this.handle?.status === "busy" || this.handle?.status === "running") {
        this.handle.status = "error";
        this.handle.error = error instanceof Error ? error.message : String(error);
        this.emit();
      }
      throw error;
    }
  }

  /** Cancel the in-flight prompt turn (ACP session/cancel). */
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
      );
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
      this.active?.dispose();
    } catch {
      // ignore
    }
    this.active = null;

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

    if (this.handle) {
      this.handle = {
        ...this.handle,
        status: "exited",
        permission: null,
        stderrTail: [...this.stderrTail],
      };
      this.emit();
    }
    this.handle = null;
  }
}

export const agentBus = new AgentBus();

/** @deprecated Use AgentTimelineItem */
export type AgentBusMessage = AgentTimelineItem;
