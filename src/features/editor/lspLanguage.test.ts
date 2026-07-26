import { describe, expect, it } from "vitest";

import {
  LSP_LANGUAGES,
  lspLanguageId,
  lspLanguageLabel,
  lspSettingGroup,
} from "./lspLanguage";

describe("lspLanguageId", () => {
  it("maps source extensions to protocol language ids", () => {
    expect(lspLanguageId("main.rs")).toBe("rust");
    expect(lspLanguageId("Screen.tsx")).toBe("typescriptreact");
    expect(lspLanguageId("store.ts")).toBe("typescript");
    expect(lspLanguageId("worker.mjs")).toBe("javascript");
    expect(lspLanguageId("render.hpp")).toBe("cpp");
    expect(lspLanguageId("styles.scss")).toBe("scss");
  });

  it("is case insensitive", () => {
    expect(lspLanguageId("MAIN.RS")).toBe("rust");
    expect(lspLanguageId("Build.YAML")).toBe("yaml");
  });

  it("returns null for file types with no configured server", () => {
    expect(lspLanguageId("Cargo.toml")).toBeNull();
    expect(lspLanguageId("README.md")).toBeNull();
    expect(lspLanguageId("Makefile")).toBeNull();
    expect(lspLanguageId(".gitignore")).toBeNull();
    expect(lspLanguageId("archive.")).toBeNull();
  });
});

describe("lspSettingGroup", () => {
  it("folds flavours onto the language that owns the server", () => {
    expect(lspSettingGroup("typescriptreact")).toBe("typescript");
    expect(lspSettingGroup("javascriptreact")).toBe("javascript");
    expect(lspSettingGroup("objective-cpp")).toBe("cpp");
    expect(lspSettingGroup("less")).toBe("css");
  });

  it("leaves base languages untouched", () => {
    expect(lspSettingGroup("rust")).toBe("rust");
    expect(lspSettingGroup("go")).toBe("go");
  });

  it("resolves every mapped extension to a settings row", () => {
    const groups = new Set(LSP_LANGUAGES.map((entry) => entry.id));
    for (const filename of [
      "a.rs",
      "a.tsx",
      "a.jsx",
      "a.py",
      "a.go",
      "a.m",
      "a.mm",
      "a.java",
      "a.json",
      "a.html",
      "a.less",
      "a.yml",
      "a.lua",
    ]) {
      const id = lspLanguageId(filename);
      expect(id).not.toBeNull();
      expect(groups.has(lspSettingGroup(id as string))).toBe(true);
    }
  });
});

describe("lspLanguageLabel", () => {
  it("labels a flavour with its owning language", () => {
    expect(lspLanguageLabel("typescriptreact")).toBe("TypeScript");
    expect(lspLanguageLabel("rust")).toBe("Rust");
  });
});
