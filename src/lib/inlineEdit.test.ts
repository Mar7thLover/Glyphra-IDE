import { describe, expect, it } from "vitest";

import {
  buildGhostTextPrompt,
  buildInlineEditPrompt,
  extractCodeBlock,
  headLines,
  normalizeInlineResult,
  sanitizeGhostText,
  shouldRequestGhostText,
  tailLines,
  GHOST_TEXT_MAX_LINES,
} from "./inlineEdit";

describe("line windows", () => {
  it("keeps the tail and head within the requested budget", () => {
    const text = "a\nb\nc\nd\ne";
    expect(tailLines(text, 2)).toBe("d\ne");
    expect(headLines(text, 2)).toBe("a\nb");
    expect(tailLines(text, 99)).toBe(text);
    expect(headLines(text, 0)).toBe("");
  });
});

describe("buildInlineEditPrompt", () => {
  it("marks a selection rewrite and carries the instruction", () => {
    const prompt = buildInlineEditPrompt({
      path: "src/app.ts",
      language: "TypeScript",
      selection: "const a = 1;",
      before: "// head",
      after: "// tail",
      instruction: "  use let  ",
    });
    expect(prompt).toContain("SELECTION");
    expect(prompt).toContain("```typescript");
    expect(prompt).toContain("const a = 1;");
    expect(prompt).toContain("File: src/app.ts");
    expect(prompt.endsWith("use let")).toBe(true);
  });

  it("switches wording when there is no selection", () => {
    const prompt = buildInlineEditPrompt({
      path: "a.rs",
      language: null,
      selection: "",
      before: "fn main() {",
      after: "}",
      instruction: "log the args",
    });
    expect(prompt).toContain("INSERTION POINT");
    expect(prompt).toContain("Insert at this point");
  });

  it("strips unsafe characters from the fence hint", () => {
    const prompt = buildInlineEditPrompt({
      path: "a",
      language: "C++ / Objective-C`",
      selection: "x",
      before: "",
      after: "",
      instruction: "y",
    });
    expect(prompt).not.toContain("`\n```c++");
    expect(prompt).toContain("```c++objective-c");
  });
});

describe("buildGhostTextPrompt", () => {
  it("places the cursor marker between the two context halves", () => {
    const prompt = buildGhostTextPrompt({
      path: "x.py",
      language: "Python",
      before: "def add(a, b):\n    return ",
      after: "\n",
    });
    expect(prompt).toContain("    return <CURSOR>");
    expect(prompt).toContain(`at most ${GHOST_TEXT_MAX_LINES} lines`);
  });
});

describe("extractCodeBlock", () => {
  it("returns the fenced body without the trailing fence newline", () => {
    expect(extractCodeBlock("chatter\n```ts\nconst a = 1;\n```\nmore")).toBe(
      "const a = 1;",
    );
  });

  it("prefers the longest block when the reply shows an example first", () => {
    const reply = "```\nold\n```\nBetter:\n```\nline one\nline two\nline three\n```";
    expect(extractCodeBlock(reply)).toBe("line one\nline two\nline three");
  });

  it("keeps an intentionally empty block", () => {
    expect(extractCodeBlock("```\n```")).toBe("");
  });

  it("normalizes CRLF replies", () => {
    expect(extractCodeBlock("```\r\na\r\nb\r\n```")).toBe("a\nb");
  });

  it("falls back to a raw code-looking reply", () => {
    expect(extractCodeBlock("const a = 1;")).toBe("const a = 1;");
  });

  it("rejects a prose refusal that would corrupt the buffer", () => {
    expect(extractCodeBlock("I cannot do that without more detail")).toBeNull();
    expect(extractCodeBlock("   ")).toBeNull();
  });
});

describe("normalizeInlineResult", () => {
  it("preserves a selection that ended with a newline", () => {
    expect(normalizeInlineResult("const a = 1;\n", "const a = 2;")).toBe(
      "const a = 2;\n",
    );
  });

  it("drops an extra trailing newline the agent added", () => {
    expect(normalizeInlineResult("const a = 1;", "const a = 2;\n\n")).toBe(
      "const a = 2;",
    );
  });

  it("matches CRLF documents", () => {
    expect(normalizeInlineResult("a\r\nb\r\n", "x\ny")).toBe("x\r\ny\r\n");
  });
});

describe("sanitizeGhostText", () => {
  it("strips an echoed current line", () => {
    expect(sanitizeGhostText("const value = ", "const value = 42;")).toBe("42;");
  });

  it("strips an echoed line even when indentation differs", () => {
    expect(sanitizeGhostText("    return ", "  return a + b")).toBe("a + b");
  });

  it("bounds the suggestion to the line budget", () => {
    const suggestion = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const result = sanitizeGhostText("x", suggestion);
    expect(result?.split("\n")).toHaveLength(GHOST_TEXT_MAX_LINES);
  });

  it("returns null for empty or whitespace-only suggestions", () => {
    expect(sanitizeGhostText("x", "")).toBeNull();
    expect(sanitizeGhostText("x", "\n  \n")).toBeNull();
    expect(sanitizeGhostText("const a = 1;", "const a = 1;")).toBeNull();
  });
});

describe("shouldRequestGhostText", () => {
  const base = {
    enabled: true,
    hasSelection: false,
    composing: false,
    readOnly: false,
    charBefore: " ",
    charAfter: "\n",
  };

  it("requests at a collapsed cursor after typed input", () => {
    expect(shouldRequestGhostText(base)).toBe(true);
  });

  it("stays out of the way of IME, selections and read-only buffers", () => {
    expect(shouldRequestGhostText({ ...base, composing: true })).toBe(false);
    expect(shouldRequestGhostText({ ...base, hasSelection: true })).toBe(false);
    expect(shouldRequestGhostText({ ...base, readOnly: true })).toBe(false);
    expect(shouldRequestGhostText({ ...base, enabled: false })).toBe(false);
  });

  it("defers to the completion popup mid-identifier", () => {
    expect(shouldRequestGhostText({ ...base, charAfter: "a" })).toBe(false);
  });

  it("skips an empty document start", () => {
    expect(shouldRequestGhostText({ ...base, charBefore: "" })).toBe(false);
  });
});
