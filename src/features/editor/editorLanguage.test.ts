import { describe, expect, it } from "vitest";

import { resolveEditorLanguage } from "./editorLanguage";

describe("editor language detection", () => {
  it("uses CodeMirror's native language catalog", () => {
    expect(resolveEditorLanguage("Screen.tsx")?.name).toBe("TSX");
    expect(resolveEditorLanguage("Cargo.toml")?.name).toBe("TOML");
    expect(resolveEditorLanguage("Widget.vue")?.name).toBe("Vue");
  });

  it("covers common source and configuration aliases", () => {
    expect(resolveEditorLanguage("Panel.svelte")?.name).toBe("HTML");
    expect(resolveEditorLanguage("main.tf")?.name).toBe("Properties files");
    expect(resolveEditorLanguage("Cargo.lock")?.name).toBe("TOML");
    expect(resolveEditorLanguage("shader.wgsl")?.name).toBe("C");
  });

  it("detects extensionless scripts from their shebang", () => {
    expect(resolveEditorLanguage("tool", "#!/usr/bin/env python3\nprint('ok')")?.name).toBe("Python");
    expect(resolveEditorLanguage("build", "#!/usr/bin/env bash\necho ok")?.name).toBe("Shell");
  });
});
