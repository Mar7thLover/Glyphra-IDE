import { describe, expect, it } from "vitest";

import { buildLineDiff } from "./lineDiff";

describe("buildLineDiff", () => {
  it("retains real line numbers for replacements", () => {
    const rows = buildLineDiff("one\ntwo\nthree\n", "one\nchanged\nthree\n");

    expect(rows).toEqual([
      { kind: "context", text: "one", oldLine: 1, newLine: 1 },
      { kind: "remove", text: "two", oldLine: 2, newLine: null },
      { kind: "add", text: "changed", oldLine: null, newLine: 2 },
      { kind: "context", text: "three", oldLine: 3, newLine: 3 },
    ]);
  });

  it("collapses distant unchanged regions", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const after = before.replace("line 10", "changed 10");
    const rows = buildLineDiff(before, after);

    expect(rows.some((row) => row.kind === "hunk")).toBe(true);
    expect(rows.some((row) => row.kind === "add" && row.text === "changed 10")).toBe(true);
    expect(rows.some((row) => row.kind === "remove" && row.text === "line 10")).toBe(true);
  });
});
