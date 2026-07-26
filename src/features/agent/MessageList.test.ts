import { describe, expect, it } from "vitest";

import type { AgentTimelineItem } from "@/lib/acp/types";

import { buildRows } from "./MessageList";

const system = (
  id: string,
  text: string,
  note?: "config" | "alert",
): AgentTimelineItem => ({ id, kind: "system", text, note, at: 1 });

describe("buildRows", () => {
  it("drops session bookkeeping that the pills and status chip already carry", () => {
    const rows = buildRows([
      system("s1", "Connected to Claude Code · claude-stream-json"),
      system("s2", "Mode: standard (auto-approval)"),
      system("s3", "Model: haiku · effort medium"),
      { id: "u1", kind: "user", text: "hi", at: 2 },
      { id: "a1", kind: "assistant", text: "hello", at: 3 },
      system("s4", "Turn complete (end_turn)"),
    ]);

    expect(rows.map((row) => row.key)).toEqual(["u1", "a1"]);
  });

  it("keeps configuration switches and folds consecutive ones", () => {
    const rows = buildRows([
      { id: "a1", kind: "assistant", text: "done", at: 1 },
      system("s1", "Next turn: model gpt-5", "config"),
      system("s2", "Next turn: effort high", "config"),
      { id: "u1", kind: "user", text: "go on", at: 4 },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      key: "s1",
      kind: "system",
      tone: "config",
      texts: ["Next turn: model gpt-5", "Next turn: effort high"],
    });
  });

  it("keeps failures and does not fold them into a config seam", () => {
    const rows = buildRows([
      system("s1", "Next turn: effort high", "config"),
      system("s2", "Agent crashed (exit 1).", "alert"),
    ]);

    expect(rows.map((row) => row.kind === "system" && row.tone)).toEqual([
      "config",
      "alert",
    ]);
  });

  it("keeps non-system items in order and untouched", () => {
    const items: AgentTimelineItem[] = [
      { id: "u1", kind: "user", text: "a", at: 1 },
      { id: "t1", kind: "thought", text: "b", at: 2 },
      { id: "a1", kind: "assistant", text: "c", at: 3 },
    ];
    const rows = buildRows(items);

    expect(rows.map((row) => row.key)).toEqual(["u1", "t1", "a1"]);
    expect(rows.every((row) => row.kind === "item")).toBe(true);
  });

  it("returns nothing for an empty timeline", () => {
    expect(buildRows([])).toEqual([]);
  });
});
