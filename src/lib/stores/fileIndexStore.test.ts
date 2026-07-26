import { describe, expect, it } from "vitest";

import {
  collectFolders,
  discoverRules,
  fuzzyScore,
  rankFiles,
  rankSymbols,
} from "./fileIndexStore";

describe("fileIndexStore fuzzy ranking", () => {
  it("prefers basename matches", () => {
    const ranked = rankFiles(
      ["src/app/App.tsx", "src/lib/stores/appStore.ts", "README.md"],
      "app",
      10,
    );
    expect(ranked[0]).toBe("src/app/App.tsx");
  });

  it("scores subsequence matches", () => {
    expect(fuzzyScore("edt", "src/features/editor/CodeEditor.tsx")).toBeGreaterThan(0);
    expect(fuzzyScore("zzz", "src/features/editor/CodeEditor.tsx")).toBe(0);
  });

  it("derives repository folders without duplicates", () => {
    expect(
      collectFolders([
        "src/features/editor/CodeEditor.tsx",
        "src/features/agent/AgentComposer.tsx",
        "README.md",
      ]),
    ).toEqual(["src", "src/features", "src/features/agent", "src/features/editor"]);
  });

  it("discovers supported nested rule files with root rules first", () => {
    const rules = discoverRules("C:\\repo", [
      "packages/app/AGENTS.md",
      "CLAUDE.md",
      ".cursorrules",
      "README.md",
    ]);
    expect(rules.map((rule) => rule.relativePath)).toEqual([
      ".cursorrules",
      "CLAUDE.md",
      "packages/app/AGENTS.md",
    ]);
    expect(rules[2].path).toBe("C:\\repo\\packages\\app\\AGENTS.md");
  });

  it("ranks exact symbol names ahead of path-only matches", () => {
    const ranked = rankSymbols(
      [
        {
          name: "openProject",
          kind: "function",
          path: "src/project.ts",
          line: 8,
          signature: "export function openProject()",
        },
        {
          name: "openFile",
          kind: "function",
          path: "src/openProjectHelpers.ts",
          line: 4,
          signature: "export function openFile()",
        },
      ],
      "openProject",
    );
    expect(ranked[0].name).toBe("openProject");
  });
});
