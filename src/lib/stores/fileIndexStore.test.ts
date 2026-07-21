import { describe, expect, it } from "vitest";

import { fuzzyScore, rankFiles } from "./fileIndexStore";

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
});
