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

  it("preserves structured file diffs from tool updates", () => {
    let items = applySessionUpdate([], {
      sessionUpdate: "tool_call",
      toolCallId: "edit-1",
      title: "Edit a.ts",
      kind: "edit",
      status: "in_progress",
    });
    items = applySessionUpdate(items, {
      sessionUpdate: "tool_call_update",
      toolCallId: "edit-1",
      status: "completed",
      content: [
        {
          type: "diff",
          path: "/repo/a.ts",
          oldText: "const a = 1;\n",
          newText: "const a = 2;\n",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      kind: "tool",
      content: [
        {
          kind: "diff",
          path: "/repo/a.ts",
          oldText: "const a = 1;\n",
          newText: "const a = 2;\n",
        },
      ],
    });
  });

  it("merges streamed thought chunks into a collapsible item", () => {
    let items = applySessionUpdate([], {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Inspect " },
    });
    items = applySessionUpdate(items, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "the store." },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "thought", text: "Inspect the store." });
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
