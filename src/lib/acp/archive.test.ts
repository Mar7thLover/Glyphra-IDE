import { describe, expect, it } from "vitest";

import { titleFromItems } from "./archive";
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
