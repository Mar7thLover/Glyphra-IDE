import { describe, expect, it } from "vitest";

import { buildCompletionOptions } from "./editorCompletion";

describe("buildCompletionOptions", () => {
  it("combines snippets, keywords, open-buffer words and workspace paths", () => {
    const options = buildCompletionOptions({
      path: "C:/repo/src/app.ts",
      currentContent: "const requestCoordinator = 1;",
      buffers: [
        {
          path: "C:/repo/src/other.ts",
          content: "export class WorkspaceController {}",
        },
      ],
      indexedFiles: ["src/app.ts", "src/other.ts"],
    });
    const labels = options.map((option) => option.label);
    expect(labels).toContain("function");
    expect(labels).toContain("await");
    expect(labels).toContain("requestCoordinator");
    expect(labels).toContain("WorkspaceController");
    expect(labels).toContain("src/other.ts");
  });

  it("adds language-specific snippets", () => {
    const rust = buildCompletionOptions({
      path: "src/lib.rs",
      currentContent: "",
      buffers: [],
      indexedFiles: [],
    });
    expect(rust.map((option) => option.label)).toContain("impl");
    expect(rust.map((option) => option.label)).toContain("crate");
  });
});
