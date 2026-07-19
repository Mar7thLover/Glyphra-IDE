import { Channel } from "@tauri-apps/api/core";

import { ipc, type AgentIoEvent } from "@/lib/ipc/ipc";
import type { AgentSpawnRequest } from "@/lib/ipc/ipc";

/**
 * Bridge a Tauri Channel of AgentIo events into a ReadableStream of stdout
 * lines, while exposing write/kill helpers for the AgentBus.
 */
export interface AcpTransport {
  sessionId: number;
  readable: ReadableStream<string>;
  write(line: string): Promise<void>;
  kill(): Promise<void>;
}

export async function openAgentTransport(request: AgentSpawnRequest): Promise<AcpTransport> {
  let controller: ReadableStreamDefaultController<string> | null = null;
  const readable = new ReadableStream<string>({
    start(c) {
      controller = c;
    },
    cancel() {
      controller = null;
    },
  });

  const sessionId = await ipc.agentSpawn(request, (event: AgentIoEvent) => {
    if (!controller) return;
    if (event.kind === "stdout") {
      controller.enqueue(event.data);
    } else if (event.kind === "stderr") {
      // Surface stderr as a synthetic comment line for the UI stream.
      controller.enqueue(JSON.stringify({ type: "stderr", data: event.data }));
    } else if (event.kind === "exit") {
      try {
        controller.close();
      } catch {
        // already closed
      }
      controller = null;
    }
  });

  return {
    sessionId,
    readable,
    write: (line) => ipc.agentWrite(sessionId, line),
    kill: () => ipc.agentKill(sessionId),
  };
}

/** Helper kept for callers that want a raw Channel without the stream wrap. */
export function createAgentIoChannel(onEvent: (event: AgentIoEvent) => void) {
  return new Channel<AgentIoEvent>(onEvent);
}
