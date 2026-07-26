import { describe, expect, it } from "vitest";

import {
  applyUnifiedPatch,
  parseUnifiedPatchFiles,
  safeProjectRelativePath,
} from "./unifiedPatch";

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
