import { describe, expect, it } from "vitest";

import { continuationContext, sessionLabel, titleFromItems } from "./archive";
import type { AgentTimelineItem } from "./types";

describe("titleFromItems", () => {
  it("uses the first user message", () => {
    const items: AgentTimelineItem[] = [
      { id: "s1", kind: "system", text: "boot", at: 1 },
      { id: "u1", kind: "user", text: "  Refactor the agent panel  ", at: 2 },
      { id: "a1", kind: "assistant", text: "Sure", at: 3 },
    ];
    expect(titleFromItems(items)).toBe("Refactor the agent panel");
  });

  it("truncates long titles", () => {
    const long = "x".repeat(80);
    const items: AgentTimelineItem[] = [{ id: "u1", kind: "user", text: long, at: 1 }];
    expect(titleFromItems(items).endsWith("…")).toBe(true);
    expect(titleFromItems(items).length).toBeLessThanOrEqual(49);
  });

  it("falls back when empty", () => {
    expect(titleFromItems([])).toBe("Untitled session");
  });
});

describe("sessionLabel", () => {
  const asked: AgentTimelineItem[] = [
    { id: "s1", kind: "system", text: "Connected", at: 1 },
    { id: "u1", kind: "user", text: "Tidy the agent timeline", at: 2 },
  ];

  it("prefers an explicit rename over the derived title", () => {
    expect(sessionLabel(asked, "  Timeline work  ", "Claude Code")).toBe("Timeline work");
  });

  it("derives from the first user message when there is no rename", () => {
    expect(sessionLabel(asked, null, "Claude Code")).toBe("Tidy the agent timeline");
  });

  it("uses the agent name only until something has been said", () => {
    expect(sessionLabel([], null, "Claude Code")).toBe("Claude Code");
    expect(sessionLabel([{ id: "s1", kind: "system", text: "Connected", at: 1 }], "", "Codex")).toBe(
      "Codex",
    );
  });
});

describe("continuationContext", () => {
  it("keeps conversational content and omits local system/tool noise", () => {
    const context = continuationContext([
      { id: "s", kind: "system", text: "Connected", at: 1 },
      { id: "u", kind: "user", text: "Fix the parser", at: 2 },
      {
        id: "t",
        kind: "tool",
        toolCallId: "tool-1",
        title: "Read file",
        status: "completed",
        at: 3,
      },
      { id: "a", kind: "assistant", text: "I found the edge case.", at: 4 },
    ]);

    expect(context).toContain("User: Fix the parser");
    expect(context).toContain("Assistant: I found the edge case.");
    expect(context).not.toContain("Connected");
    expect(context).not.toContain("Read file");
  });
});
