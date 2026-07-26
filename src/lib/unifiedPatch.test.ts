import { describe, expect, it } from "vitest";

import {
  applyUnifiedPatch,
  extractPatchBlocks,
  parseUnifiedPatchFiles,
  patchStats,
  safeProjectRelativePath,
} from "./unifiedPatch";

const twoFilePatch = [
  "Here is the change:",
  "```diff",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-const a = 1;",
  "+const a = 2;",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1,2 @@",
  " const b = 1;",
  "+const c = 3;",
  "```",
].join("\n");

describe("extractPatchBlocks", () => {
  it("reads every file out of one fenced patch", () => {
    const files = extractPatchBlocks(twoFilePatch);
    expect(files.map((file) => file.newPath)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("accepts any fence label, including none", () => {
    for (const label of ["diff", "patch", "git", ""]) {
      const text = ["```" + label, "--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "-a", "+b", "```"]
        .join("\n");
      expect(extractPatchBlocks(text)).toHaveLength(1);
    }
  });

  it("ignores fenced code that is not a unified diff", () => {
    const text = [
      "```ts",
      "const plus = '+added';",
      "const minus = '-removed';",
      "```",
      "```",
      "--- not a diff, just a sentence",
      "```",
    ].join("\n");
    expect(extractPatchBlocks(text)).toEqual([]);
  });

  it("ignores diff-looking prose outside a fence", () => {
    expect(
      extractPatchBlocks("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b"),
    ).toEqual([]);
  });
});

describe("patchStats", () => {
  it("counts changed lines without mistaking the file headers for edits", () => {
    expect(patchStats(extractPatchBlocks(twoFilePatch))).toEqual({ added: 2, removed: 1 });
  });
});

const diff = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a, b };",
].join("\n");

describe("unified patch application", () => {
  it("parses file paths and applies matching hunks", () => {
    expect(parseUnifiedPatchFiles(diff)[0]).toMatchObject({
      oldPath: "src/a.ts",
      newPath: "src/a.ts",
    });
    expect(applyUnifiedPatch("const a = 1;\nconst b = 2;\nexport { a, b };\n", diff)).toBe(
      "const a = 1;\nconst b = 3;\nconst c = 4;\nexport { a, b };\n",
    );
  });

  it("refuses stale context instead of guessing", () => {
    expect(() => applyUnifiedPatch("const a = 9;\n", diff)).toThrow("no longer matches");
  });

  it("rejects absolute and traversal paths", () => {
    expect(safeProjectRelativePath("src/a.ts")).toBe("src/a.ts");
    expect(safeProjectRelativePath("../outside.ts")).toBeNull();
    expect(safeProjectRelativePath("C:/outside.ts")).toBeNull();
    expect(safeProjectRelativePath("/outside.ts")).toBeNull();
  });
});
