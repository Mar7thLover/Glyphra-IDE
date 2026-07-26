import { create } from "zustand";

import { ipc, type ProjectSymbol } from "@/lib/ipc/ipc";

export interface ProjectRuleInfo {
  name: string;
  kind: "agents" | "claude" | "cursor";
  path: string;
  relativePath: string;
}

interface FileIndexState {
  projectPath: string | null;
  files: string[];
  folders: string[];
  symbols: ProjectSymbol[];
  rules: ProjectRuleInfo[];
  indexed: boolean;
  loading: boolean;
  error: string | null;
  ensureIndexed: (projectPath: string) => Promise<string[]>;
  refresh: (projectPath: string) => Promise<string[]>;
  clear: () => void;
}

function joinProject(root: string, relative: string) {
  const base = root.replace(/[\\/]+$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  return `${base}${sep}${relative.replace(/\//g, sep)}`;
}

export function fuzzyScore(query: string, path: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const hay = path.toLowerCase();
  const name = hay.split("/").pop() ?? hay;
  if (name === q) return 10_000;
  if (name.startsWith(q)) return 5_000 - name.length;
  if (name.includes(q)) return 2_000 - name.indexOf(q);
  if (hay.includes(q)) return 1_000 - hay.indexOf(q);

  // Subsequence match (vscode-ish light fuzzy).
  let qi = 0;
  let score = 0;
  let last = -1;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] !== q[qi]) continue;
    score += last >= 0 && i === last + 1 ? 5 : 1;
    last = i;
    qi += 1;
  }
  return qi === q.length ? score : 0;
}

export function rankFiles(files: string[], query: string, limit = 40): string[] {
  const scored = files
    .map((path) => ({ path, score: fuzzyScore(query, path) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((item) => item.path);
}

export function collectFolders(files: string[]): string[] {
  const folders = new Set<string>();
  for (const file of files) {
    const segments = file.replace(/\\/g, "/").split("/");
    for (let index = 1; index < segments.length; index += 1) {
      folders.add(segments.slice(0, index).join("/"));
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

export function discoverRules(projectPath: string, files: string[]): ProjectRuleInfo[] {
  const candidates: Record<string, ProjectRuleInfo["kind"]> = {
    "AGENTS.md": "agents",
    "CLAUDE.md": "claude",
    ".cursorrules": "cursor",
  };
  return files
    .map((relativePath) => {
      const name = relativePath.split("/").pop() ?? relativePath;
      const kind = candidates[name];
      if (!kind) return null;
      return {
        name,
        kind,
        path: absoluteFromIndex(projectPath, relativePath),
        relativePath,
      } satisfies ProjectRuleInfo;
    })
    .filter((rule): rule is ProjectRuleInfo => rule !== null)
    .sort(
      (a, b) =>
        a.relativePath.split("/").length - b.relativePath.split("/").length ||
        a.relativePath.localeCompare(b.relativePath),
    );
}

export function rankSymbols(
  symbols: ProjectSymbol[],
  query: string,
  limit = 40,
): ProjectSymbol[] {
  return symbols
    .map((symbol) => ({
      symbol,
      score:
        fuzzyScore(query, symbol.name) * 2 +
        fuzzyScore(query, `${symbol.name} ${symbol.path}`),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.symbol.name.localeCompare(b.symbol.name) ||
        a.symbol.path.localeCompare(b.symbol.path),
    )
    .slice(0, limit)
    .map((item) => item.symbol);
}

export const useFileIndexStore = create<FileIndexState>((set, get) => ({
  projectPath: null,
  files: [],
  folders: [],
  symbols: [],
  rules: [],
  indexed: false,
  loading: false,
  error: null,

  ensureIndexed: async (projectPath) => {
    const state = get();
    if (state.projectPath === projectPath && state.indexed && !state.loading) {
      return state.files;
    }
    if (state.projectPath === projectPath && state.loading) return state.files;
    return get().refresh(projectPath);
  },

  refresh: async (projectPath) => {
    set({
      loading: true,
      error: null,
      projectPath,
      indexed: false,
    });
    try {
      const raw = await ipc.gitExecReadonly(projectPath, [
        "ls-files",
        "-co",
        "--exclude-standard",
      ]);
      const files = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((relative) => relative.replace(/\\/g, "/"));
      // De-dupe while preserving order.
      const unique = [...new Set(files)];
      const folders = collectFolders(unique);
      const rules = discoverRules(projectPath, unique);
      // Publish file/folder/rule results immediately; symbol scanning has a
      // separate bounded Rust pass and may finish a little later on large repos.
      if (get().projectPath !== projectPath) return unique;
      set({ files: unique, folders, rules });
      const symbols = await ipc.projectSymbols(projectPath, unique);
      if (get().projectPath !== projectPath) return unique;
      set({
        files: unique,
        folders,
        symbols,
        rules,
        indexed: true,
        loading: false,
        error: null,
      });
      return unique;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (get().projectPath === projectPath) {
        set({
          files: [],
          folders: [],
          symbols: [],
          rules: [],
          indexed: true,
          loading: false,
          error: message,
        });
      }
      return [];
    }
  },

  clear: () =>
    set({
      projectPath: null,
      files: [],
      folders: [],
      symbols: [],
      rules: [],
      indexed: false,
      loading: false,
      error: null,
    }),
}));

export function absoluteFromIndex(projectPath: string, relative: string) {
  return joinProject(projectPath, relative);
}
