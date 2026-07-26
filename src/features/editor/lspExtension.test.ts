import { describe, expect, it } from "vitest";

import type { LspTextEdit } from "@/lib/ipc/ipc";

import { applyTextEdits } from "./lspExtension";

function edit(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  newText: string,
): LspTextEdit {
  return {
    path: "C:/repo/main.rs",
    startLine,
    startColumn,
    endLine,
    endColumn,
    newText,
  };
}

describe("applyTextEdits", () => {
  it("applies a single-line replacement using 1-based coordinates", () => {
    expect(applyTextEdits("let value = 1;\n", [edit(1, 5, 1, 10, "total")])).toBe(
      "let total = 1;\n",
    );
  });

  it("keeps earlier offsets valid when several edits land in one file", () => {
    const content = "alpha\nbeta\ngamma\n";
    const result = applyTextEdits(content, [
      edit(1, 1, 1, 6, "one"),
      edit(3, 1, 3, 6, "three"),
      edit(2, 1, 2, 5, "two"),
    ]);
    expect(result).toBe("one\ntwo\nthree\n");
  });

  it("spans line boundaries", () => {
    expect(applyTextEdits("first\nsecond\nthird\n", [edit(1, 3, 3, 3, "X")])).toBe(
      "fiXird\n",
    );
  });

  it("drops overlapping ranges rather than corrupting the document", () => {
    const content = "abcdef\n";
    // Both edits claim column 2-5; only the later-sorted one may apply.
    const result = applyTextEdits(content, [edit(1, 2, 1, 5, "Z"), edit(1, 3, 1, 6, "Y")]);
    expect(result).toBe("abYf\n");
  });

  it("clamps out-of-range positions instead of throwing", () => {
    expect(applyTextEdits("one\n", [edit(9, 9, 9, 9, "!")])).toBe("one\n!");
    expect(applyTextEdits("one\n", [edit(1, 99, 1, 99, "!")])).toBe("one!\n");
  });

  it("handles CRLF documents", () => {
    expect(applyTextEdits("let a = 1;\r\nlet b = 2;\r\n", [edit(2, 5, 2, 6, "beta")])).toBe(
      "let a = 1;\r\nlet beta = 2;\r\n",
    );
  });

  it("returns the input unchanged when there is nothing to apply", () => {
    expect(applyTextEdits("stable\n", [])).toBe("stable\n");
  });
});
