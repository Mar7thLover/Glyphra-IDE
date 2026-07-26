import { describe, expect, it } from "vitest";

import {
  composeAgentPrompt,
  expandSlashCommand,
  extractSymbolContext,
  findMentionMatch,
  findSlashMatch,
  hydrateFileReferences,
  replaceMentionMatch,
  replaceSlashMatch,
  truncateReferenceContent,
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

  it("truncates oversized reference content with a marker", () => {
    expect(truncateReferenceContent("hello", 10)).toBe("hello");

    const capped = truncateReferenceContent("x".repeat(50), 10);
    expect(capped.startsWith("x".repeat(10))).toBe(true);
    expect(capped).toContain("[truncated 10 of 50 chars]");
  });

  it("finds unscoped mentions after prose", () => {
    const value = "Please inspect @editor";
    expect(findMentionMatch(value, value.length)).toEqual({
      start: 15,
      end: value.length,
      kind: null,
      query: "editor",
    });
  });

  it("supports explicit mention scopes and replaces only the active token", () => {
    expect(findMentionMatch("@file:store", 11)?.kind).toBe("file");
    expect(findMentionMatch("@folder:src", 11)?.kind).toBe("folder");
    expect(findMentionMatch("@symbol:open", 12)?.kind).toBe("symbol");

    const value = "Review @file:App";
    const match = findMentionMatch(value, value.length);
    expect(replaceMentionMatch(value, match!).value).toBe("Review ");
  });

  it("hydrates file references from the live buffer before disk", async () => {
    const readFile = async () => "disk";
    const [reference] = await hydrateFileReferences(
      [{ id: "1", kind: "file", label: "a.ts", path: "/repo/a.ts", content: "" }],
      [{ path: "/repo/a.ts", content: "unsaved edit" }],
      readFile,
    );

    expect(reference.content).toBe("unsaved edit");
  });

  it("hydrates closed files from disk and preserves unreadable placeholders", async () => {
    const references = await hydrateFileReferences(
      [
        { id: "1", kind: "file", label: "a.ts", path: "/repo/a.ts", content: "" },
        {
          id: "2",
          kind: "file",
          label: "missing.ts",
          path: "/repo/missing.ts",
          content: "Workspace file: /repo/missing.ts",
        },
      ],
      [],
      async (path) => {
        if (path.endsWith("missing.ts")) throw new Error("missing");
        return "disk content";
      },
    );

    expect(references[0].content).toBe("disk content");
    expect(references[1].content).toBe("Workspace file: /repo/missing.ts");
  });

  it("hydrates folders with bounded repository file contents", async () => {
    const [reference] = await hydrateFileReferences(
      [
        {
          id: "folder-1",
          kind: "folder",
          label: "src",
          path: "/repo/src",
          relativePath: "src",
          content: "Workspace folder: src",
        },
      ],
      [{ path: "/repo/src/live.ts", content: "const unsaved = true;" }],
      async (path) => `disk:${path}`,
      {
        indexedFiles: [
          { path: "/repo/src/live.ts", relativePath: "src/live.ts" },
          { path: "/repo/src/disk.ts", relativePath: "src/disk.ts" },
          { path: "/repo/README.md", relativePath: "README.md" },
        ],
      },
    );
    expect(reference.content).toContain("--- src/live.ts ---\nconst unsaved = true;");
    expect(reference.content).toContain("--- src/disk.ts ---\ndisk:/repo/src/disk.ts");
    expect(reference.content).not.toContain("README");
  });

  it("hydrates symbols with numbered context around the indexed line", async () => {
    const [reference] = await hydrateFileReferences(
      [
        {
          id: "symbol-1",
          kind: "symbol",
          label: "target",
          path: "/repo/src/a.ts",
          line: 3,
          content: "function target()",
        },
      ],
      [],
      async () => ["one", "two", "function target() {}", "four"].join("\n"),
    );
    expect(reference.content).toContain("> 3 | function target() {}");
    expect(reference.content).toContain("/repo/src/a.ts:3");
  });

  it("clamps invalid symbol line numbers", () => {
    expect(extractSymbolContext("one\ntwo", 99)).toContain("> 2 | two");
  });
});
