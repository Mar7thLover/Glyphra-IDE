import { describe, expect, it } from "vitest";

import {
  composeAgentPrompt,
  expandSlashCommand,
  findSlashMatch,
  replaceSlashMatch,
} from "./composerContext";

describe("composer context", () => {
  it("finds and replaces a slash query at the caret", () => {
    const value = "Please\n  /rev";
    const match = findSlashMatch(value, value.length);
    expect(match).toEqual({ start: 9, end: 13, query: "rev" });
    expect(replaceSlashMatch(value, match!, "/review ")).toEqual({
      value: "Please\n  /review ",
      cursor: 17,
    });
  });

  it("expands Skill and MCP references into portable instructions", () => {
    expect(expandSlashCommand("/skill pdf create a report")).toBe(
      "Use the $pdf Skill for this task.\n\ncreate a report",
    );
    expect(expandSlashCommand("/mcp github inspect the issue")).toBe(
      'Use the "github" MCP server when relevant.\n\ninspect the issue',
    );
  });

  it("serializes attached references with the prompt", () => {
    const result = composeAgentPrompt("/explain", [
      { id: "1", kind: "selection", label: "Agent output", content: "selected text" },
      {
        id: "2",
        kind: "code",
        label: "main.ts:L4-L6",
        path: "D:/project/src/main.ts",
        content: "const answer = 42;",
      },
    ]);
    expect(result).toContain("Explain the referenced context clearly and concisely.");
    expect(result).toContain('<reference kind="selection" label="Agent output">');
    expect(result).toContain("selected text");
    expect(result).toContain(
      '<reference kind="code" label="main.ts:L4-L6" path="D:/project/src/main.ts">',
    );
    expect(result).toContain("const answer = 42;");
  });
});
