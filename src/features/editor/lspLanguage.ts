/**
 * Filename → LSP `languageId`, mirroring `server_specs` in `src-tauri/src/lsp.rs`.
 *
 * Only ids the Rust side can actually start a server for appear here, so the
 * editor never pays an IPC round-trip for a file type with no server.
 */

export interface LspLanguageInfo {
  /** LSP `languageId` sent in `textDocument/didOpen`. */
  id: string;
  /** Human-facing name for settings and status surfaces. */
  label: string;
  /** Executable Glyphra looks for on `PATH`. */
  server: string;
}

/** One entry per server, in the order the settings page lists them. */
export const LSP_LANGUAGES: LspLanguageInfo[] = [
  { id: "rust", label: "Rust", server: "rust-analyzer" },
  { id: "typescript", label: "TypeScript", server: "typescript-language-server" },
  { id: "javascript", label: "JavaScript", server: "typescript-language-server" },
  { id: "python", label: "Python", server: "pyright-langserver" },
  { id: "go", label: "Go", server: "gopls" },
  { id: "c", label: "C", server: "clangd" },
  { id: "cpp", label: "C++", server: "clangd" },
  { id: "java", label: "Java", server: "jdtls" },
  { id: "json", label: "JSON", server: "vscode-json-language-server" },
  { id: "html", label: "HTML", server: "vscode-html-language-server" },
  { id: "css", label: "CSS", server: "vscode-css-language-server" },
  { id: "yaml", label: "YAML", server: "yaml-language-server" },
  { id: "lua", label: "Lua", server: "lua-language-server" },
];

const EXTENSION_LANGUAGE_IDS: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  py: "python",
  pyi: "python",
  go: "go",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  m: "objective-c",
  mm: "objective-cpp",
  java: "java",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  yaml: "yaml",
  yml: "yaml",
  lua: "lua",
};

/**
 * `languageId` a settings toggle controls. React/flavour ids share one server
 * with their base language, so `typescriptreact` is governed by `typescript`
 * and `scss` by `css`.
 */
const SETTING_GROUPS: Record<string, string> = {
  typescriptreact: "typescript",
  javascriptreact: "javascript",
  "objective-c": "c",
  "objective-cpp": "cpp",
  scss: "css",
  less: "css",
};

export function lspLanguageId(filename: string): string | null {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot === lower.length - 1) return null;
  return EXTENSION_LANGUAGE_IDS[lower.slice(dot + 1)] ?? null;
}

export function lspSettingGroup(languageId: string): string {
  return SETTING_GROUPS[languageId] ?? languageId;
}

export function lspLanguageLabel(languageId: string): string {
  const group = lspSettingGroup(languageId);
  return LSP_LANGUAGES.find((entry) => entry.id === group)?.label ?? languageId;
}
