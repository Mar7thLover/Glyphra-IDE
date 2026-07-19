import type { AgentBackendKind } from "./types";
import { openAgentTransport, type AcpTransport } from "./stream";

export interface AgentBusMessage {
  role: "assistant" | "system" | "user";
  text: string;
  at: number;
}

export interface AgentSessionHandle {
  backend: AgentBackendKind | "fixture";
  sessionId: number;
  transport: AcpTransport;
  messages: AgentBusMessage[];
  status: "running" | "exited" | "error";
  error?: string;
}

type Listener = (session: AgentSessionHandle) => void;

/**
 * Lightweight AgentBus (M1 skeleton). Owns transport lifecycle and a simple
 * NDJSON message log. Full ACP SDK client wiring lands in a follow-up.
 */
export class AgentBus {
  private session: AgentSessionHandle | null = null;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    if (this.session) listener(this.session);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSession() {
    return this.session;
  }

  private emit() {
    if (!this.session) return;
    const snapshot = { ...this.session, messages: [...this.session.messages] };
    for (const listener of this.listeners) listener(snapshot);
  }

  async start(backend: AgentBackendKind | "fixture", cwd: string) {
    await this.stop();
    const transport = await openAgentTransport({
      backend,
      cwd,
      command: null,
      args: [],
      env: {},
    });

    this.session = {
      backend,
      sessionId: transport.sessionId,
      transport,
      messages: [
        {
          role: "system",
          text: `Started ${backend} session #${transport.sessionId}`,
          at: Date.now(),
        },
      ],
      status: "running",
    };
    this.emit();
    void this.consume(transport);
    return this.session;
  }

  async prompt(text: string) {
    if (!this.session || this.session.status !== "running") {
      throw new Error("No running agent session");
    }
    this.session.messages.push({ role: "user", text, at: Date.now() });
    this.emit();

    // Minimal JSON-RPC prompt until @agentclientprotocol/sdk is wired.
    const req = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "session/prompt",
      params: {
        sessionId: "fixture-session",
        prompt: [{ type: "text", text }],
      },
    };
    await this.session.transport.write(JSON.stringify(req));
  }

  async stop() {
    if (!this.session) return;
    try {
      await this.session.transport.kill();
    } catch {
      // process may already be gone
    }
    this.session = { ...this.session, status: "exited" };
    this.emit();
    this.session = null;
  }

  private async consume(transport: AcpTransport) {
    const reader = transport.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.ingestLine(value);
      }
      if (this.session) {
        this.session = { ...this.session, status: "exited" };
        this.emit();
      }
    } catch (error) {
      if (this.session) {
        this.session = {
          ...this.session,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        this.emit();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private ingestLine(line: string) {
    if (!this.session) return;
    try {
      const msg = JSON.parse(line) as {
        method?: string;
        params?: { update?: { content?: { text?: string }; sessionUpdate?: string } };
        type?: string;
        data?: string;
        result?: unknown;
      };
      if (msg.type === "stderr" && msg.data) {
        this.session.messages.push({
          role: "system",
          text: msg.data,
          at: Date.now(),
        });
        this.emit();
        return;
      }
      const chunk = msg.params?.update?.content?.text;
      if (msg.method === "session/update" && chunk) {
        const last = this.session.messages.at(-1);
        if (last?.role === "assistant") {
          last.text += chunk;
        } else {
          this.session.messages.push({ role: "assistant", text: chunk, at: Date.now() });
        }
        this.emit();
      }
    } catch {
      this.session.messages.push({
        role: "system",
        text: line,
        at: Date.now(),
      });
      this.emit();
    }
  }
}

export const agentBus = new AgentBus();
