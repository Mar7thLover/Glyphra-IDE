import { beforeEach, describe, expect, it } from "vitest";

import { useDiagnosticsStore } from "./diagnosticsStore";
import { lspTestHooks, useLspStore } from "./lspStore";

const { applyDiagnostics, retractLanguage, toGlyphraDiagnostic } = lspTestHooks;

function diagnostic(path: string, message: string, severity = "error") {
  return {
    path,
    line: 4,
    column: 9,
    endLine: 4,
    endColumn: 14,
    severity,
    message,
    source: "rustc",
    code: "E0308",
  };
}

describe("lsp diagnostics ingestion", () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearAll();
    useLspStore.getState().reset();
  });

  it("maps protocol diagnostics onto the shared Problems model", () => {
    const mapped = toGlyphraDiagnostic(diagnostic("C:/repo/src/main.rs", "mismatched types"));
    expect(mapped).toMatchObject({
      path: "C:/repo/src/main.rs",
      line: 4,
      column: 9,
      endLine: 4,
      endColumn: 14,
      severity: "error",
      message: "mismatched types",
      source: "lsp",
      code: "E0308",
    });
  });

  it("falls back to info for severities the panel does not model", () => {
    expect(toGlyphraDiagnostic(diagnostic("a.rs", "hint", "hint")).severity).toBe("info");
    expect(toGlyphraDiagnostic(diagnostic("a.rs", "warn", "warning")).severity).toBe("warning");
  });

  it("replaces a file's findings on every publish", () => {
    applyDiagnostics({
      languageId: "rust",
      path: "C:/repo/src/main.rs",
      diagnostics: [diagnostic("C:/repo/src/main.rs", "first")],
    });
    applyDiagnostics({
      languageId: "rust",
      path: "C:/repo/src/main.rs",
      diagnostics: [diagnostic("C:/repo/src/main.rs", "second")],
    });
    const items = useDiagnosticsStore.getState().diagnostics;
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("second");
  });

  it("keeps other sources for the same file", () => {
    useDiagnosticsStore.getState().replaceFile("editor", "C:/repo/src/main.rs", [
      {
        id: "editor:1",
        path: "C:/repo/src/main.rs",
        line: 1,
        column: 1,
        severity: "warning",
        message: "trailing whitespace",
        source: "editor",
        at: 0,
      },
    ]);
    applyDiagnostics({
      languageId: "rust",
      path: "C:/repo/src/main.rs",
      diagnostics: [diagnostic("C:/repo/src/main.rs", "mismatched types")],
    });
    const sources = useDiagnosticsStore
      .getState()
      .diagnostics.map((item) => item.source)
      .sort();
    expect(sources).toEqual(["editor", "lsp"]);
  });

  it("retracts only the findings of the server that stopped", () => {
    applyDiagnostics({
      languageId: "rust",
      path: "C:/repo/src/main.rs",
      diagnostics: [diagnostic("C:/repo/src/main.rs", "rust problem")],
    });
    applyDiagnostics({
      languageId: "typescript",
      path: "C:/repo/src/app.ts",
      diagnostics: [diagnostic("C:/repo/src/app.ts", "ts problem")],
    });
    retractLanguage("rust");
    const items = useDiagnosticsStore.getState().diagnostics;
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("C:/repo/src/app.ts");
  });

  it("forgets a file once the server reports it clean", () => {
    applyDiagnostics({
      languageId: "rust",
      path: "C:/repo/src/main.rs",
      diagnostics: [diagnostic("C:/repo/src/main.rs", "problem")],
    });
    applyDiagnostics({ languageId: "rust", path: "C:/repo/src/main.rs", diagnostics: [] });
    expect(useDiagnosticsStore.getState().diagnostics).toHaveLength(0);
    retractLanguage("rust");
    expect(useDiagnosticsStore.getState().diagnostics).toHaveLength(0);
  });

  it("tracks the latest status per language", () => {
    useLspStore.getState().setStatus({
      languageId: "rust",
      server: "rust-analyzer",
      state: "ready",
      message: null,
    });
    useLspStore.getState().setStatus({
      languageId: "rust",
      server: null,
      state: "unavailable",
      message: "rust-analyzer was not found",
    });
    expect(useLspStore.getState().statuses.rust).toMatchObject({
      state: "unavailable",
      message: "rust-analyzer was not found",
    });
  });
});
