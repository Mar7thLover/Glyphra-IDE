import { describe, expect, it } from "vitest";

import {
  analyzeEditorDocument,
  diagnosticCounts,
  parseDiagnosticText,
  resolveDiagnosticPath,
  stripAnsi,
} from "./diagnostics";

describe("diagnostics", () => {
  it("parses TypeScript, GCC and Rust locations inside the project", () => {
    const diagnostics = parseDiagnosticText(
      [
        "src/app.ts(4,9): error TS2322: Type 'string' is not assignable",
        "src/main.c:8:2: warning: unused variable",
        "error[E0308]: mismatched types",
        "  --> src/lib.rs:12:5",
      ].join("\n"),
      "terminal",
      "C:\\repo",
    );
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((item) => [item.path, item.line, item.source])).toEqual([
      ["C:/repo/src/app.ts", 4, "build"],
      ["C:/repo/src/main.c", 8, "build"],
      ["C:/repo/src/lib.rs", 12, "build"],
    ]);
  });

  it("rejects diagnostic paths outside the workspace", () => {
    expect(resolveDiagnosticPath("C:\\repo", "..\\secret.txt")).toBeNull();
    expect(resolveDiagnosticPath("C:\\repo", "src\\ok.ts")).toBe("C:/repo/src/ok.ts");
  });

  it("strips terminal ANSI sequences", () => {
    expect(stripAnsi("\u001b[31merror\u001b[0m\r\n")).toBe("error\n");
  });

  it("detects JSON errors and merge conflict markers", () => {
    const diagnostics = analyzeEditorDocument(
      "C:/repo/package.json",
      "{\n<<<<<<< HEAD\n}",
    );
    expect(diagnosticCounts(diagnostics).error).toBe(2);
    expect(diagnostics.some((item) => item.code === "json-parse")).toBe(true);
    expect(diagnostics.some((item) => item.code === "merge-conflict")).toBe(true);
  });
});
