import { Channel } from "@tauri-apps/api/core";
import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";

import { ipc, type AgentIoEvent, type AgentSpawnRequest } from "@/lib/ipc/ipc";

export interface AcpTransport {
  sessionId: number;
  /** ACP NDJSON stream for `@agentclientprotocol/sdk`. */
  stream: Stream;
  kill(): Promise<void>;
  onStderr(listener: (line: string) => void): () => void;
  onExit(listener: (code: string) => void): () => void;
}

/**
 * Spawn an agent subprocess and expose an ACP `Stream` over its stdio.
 * Stderr/exit are delivered separately so they never corrupt NDJSON framing.
 */
export async function openAgentTransport(request: AgentSpawnRequest): Promise<AcpTransport> {
  let bytesController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stderrListeners = new Set<(line: string) => void>();
  const exitListeners = new Set<(code: string) => void>();

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      bytesController = controller;
    },
    cancel() {
      bytesController = null;
    },
  });

  let sessionId = 0;

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      const text = new TextDecoder().decode(chunk);
      // `agent_write` preserves a trailing newline when present.
      await ipc.agentWrite(sessionId, text);
    },
  });

  sessionId = await ipc.agentSpawn(request, (event: AgentIoEvent) => {
    if (event.kind === "stdout") {
      if (!bytesController) return;
      // Channel delivers one complete line without the trailing newline.
      bytesController.enqueue(encoder.encode(`${event.data}\n`));
    } else if (event.kind === "stderr") {
      for (const listener of stderrListeners) listener(event.data);
    } else if (event.kind === "exit") {
      try {
        bytesController?.close();
      } catch {
        // already closed
      }
      bytesController = null;
      for (const listener of exitListeners) listener(event.data);
    }
  });

  return {
    sessionId,
    stream: ndJsonStream(writable, readable),
    kill: () => ipc.agentKill(sessionId),
    onStderr: (listener) => {
      stderrListeners.add(listener);
      return () => {
        stderrListeners.delete(listener);
      };
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
  };
}

export function createAgentIoChannel(onEvent: (event: AgentIoEvent) => void) {
  return new Channel<AgentIoEvent>(onEvent);
}
