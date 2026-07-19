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
}

type Listener = (session: AgentSessionHandle) => void;

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
      { id: `sys-${Date.now()}`, kind: "system", text, at: Date.now() },
    ];
    this.emit();
  }

  async start(backend: StartableBackend, cwd: string, options: AgentStartOptions = {}) {
    await this.stop();

    const mode: AgentPermissionMode = options.mode ?? "standard";

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

    this.unsubStderr = transport.onStderr((line) => this.pushSystem(line));
    this.unsubExit = transport.onExit((code) => {
      if (!this.handle) return;
      const wasBusy = this.handle.status === "busy" || this.handle.status === "starting";
      this.handle.status = wasBusy ? "crashed" : "exited";
      this.pushSystem(
        wasBusy
          ? `Agent crashed (${code}). You can restart or browse past sessions.`
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
        `Connected${this.handle.agentName ? ` to ${this.handle.agentName}` : ""} (protocol v${init.protocolVersion})`,
      );

      const authMethods = init.authMethods ?? [];
      if (authMethods.length > 0) {
        const methodId = authMethods[0]?.id;
        if (methodId) {
          await connection.agent.request(methods.agent.authenticate, { methodId });
          this.pushSystem(`Authenticated via ${methodId}`);
        }
      }

      const active = await connection.agent.buildSession(cwd).start();
      this.active = active;
      this.handle.acpSessionId = active.sessionId;

      // Best-effort session mode mapping (agents may ignore unknown modes).
      const modeId =
        mode === "safe" ? "read-only" : mode === "unleashed" ? "full-access" : "default";
      try {
        await connection.agent.request(methods.agent.session.setMode, {
          sessionId: active.sessionId,
          modeId,
        });
        this.pushSystem(`Mode: ${mode} (${modeId})`);
      } catch {
        this.pushSystem(`Mode preset: ${mode} (agent set_mode unavailable)`);
      }

      this.handle.status = "running";
      this.pushSystem(`Session ${active.sessionId}`);
      this.emit();
      return this.snapshot();
    } catch (error) {
      this.handle.status = "error";
      this.handle.error = error instanceof Error ? error.message : String(error);
      this.emit();
      await this.stop();
      throw error;
    }
  }

  async prompt(text: string) {
    if (!this.handle || !this.active || this.handle.status === "exited") {
      throw new Error("No running agent session");
    }
    if (this.handle.status === "busy") {
      throw new Error("Agent is already answering");
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
      this.handle.status = "error";
      this.handle.error = error instanceof Error ? error.message : String(error);
      this.emit();
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
      );
    }
  }

  private handlePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const id = `perm-${Date.now()}`;
    return new Promise((resolve) => {
      this.permissionWaiters.set(id, resolve);
      if (this.handle) {
        this.handle.permission = {
          id,
          title: params.toolCall.title ?? "Permission required",
          toolCallId: params.toolCall.toolCallId,
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
      this.handle = { ...this.handle, status: "exited", permission: null };
      this.emit();
    }
    this.handle = null;
  }
}

export const agentBus = new AgentBus();

/** @deprecated Use AgentTimelineItem */
export type AgentBusMessage = AgentTimelineItem;
