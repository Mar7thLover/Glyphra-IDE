import { beforeEach, describe, expect, it } from "vitest";

import { applySessionUpdate, resetTimelineIds } from "./sessionUpdates";
import type { AgentTimelineItem } from "./types";

describe("applySessionUpdate", () => {
  beforeEach(() => {
    resetTimelineIds();
  });

  it("merges consecutive assistant text chunks", () => {
    let items: AgentTimelineItem[] = [];
    items = applySessionUpdate(items, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hel" },
    });
    items = applySessionUpdate(items, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "lo" },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "Hello" });
  });

  it("tracks tool calls and updates", () => {
    let items: AgentTimelineItem[] = [];
    items = applySessionUpdate(items, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read file",
      kind: "read",
      status: "pending",
      locations: [{ path: "/a.ts" }],
    });
    items = applySessionUpdate(items, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "ok" },
        },
      ],
    });
    expect(items[0]).toMatchObject({
      kind: "tool",
      toolCallId: "t1",
      status: "completed",
      detail: "ok",
    });
  });

  it("appends plan entries", () => {
    const items = applySessionUpdate([], {
      sessionUpdate: "plan",
      entries: [{ content: "Step one", status: "pending", priority: "medium" }],
    });
    expect(items[0]).toMatchObject({
      kind: "plan",
      entries: [{ content: "Step one", status: "pending" }],
    });
  });
});
