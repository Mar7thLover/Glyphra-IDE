import { describe, expect, it } from "vitest";

import { AgentBus } from "./bus";

describe("AgentBus ingest", () => {
  it("appends assistant chunks from session/update lines", () => {
    const bus = new AgentBus();
    // Access private ingest via start-less path by casting for unit coverage.
    const ingest = (bus as unknown as { ingestLine: (line: string) => void }).ingestLine.bind(bus);
    (bus as unknown as { session: { messages: unknown[]; status: string } }).session = {
      messages: [],
      status: "running",
    };

    ingest(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hel" },
          },
        },
      }),
    );
    ingest(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "lo" },
          },
        },
      }),
    );

    const messages = bus.getSession()?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.text).toBe("Hello");
  });
});
