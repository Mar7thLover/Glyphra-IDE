import { create } from "zustand";

import { ipc, type ProjectSymbol } from "@/lib/ipc/ipc";

export interface ProjectRuleInfo {
  name: string;
  kind: "agents" | "claude" | "cursor";
  path: string;
  relativePath: string;
}

interface FileIndexState {
  /** Workspace roots this index covers (absolute paths). */
  roots: string[];
  /** Absolute file paths across every root. */
  files: string[];
  /** Display folders (absolute) derived from `files`. */
  folders: string[];
  symbols: ProjectSymbol[];
  rules: ProjectRuleInfo[];
  indexed: boolean;
  loading: boolean;
  error: string | null;
  ensureIndexed: (roots: string[]) => Promise<string[]>;
  refresh: (roots: string[]) => Promise<string[]>;
  clear: () => void;
}

function joinRoot(root: string, relative: string) {
  const base = root.replace(/[\\/]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
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
        path: joinRoot(projectPath, relativePath),
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

function sameRoots(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const normalize = (path: string) => path.replace(/\\/g, "/").toLowerCase();
  const sortedA = [...a].map(normalize).sort();
  const sortedB = [...b].map(normalize).sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/** Segments that never belong in the Ctrl+P / mention index. `git ls-files -co`
 *  lists untracked files too, so a game-assets tree of 100k+ files would
 *  otherwise flood the index with paths nobody can fuzzy-open usefully. */
const INDEX_PRUNE_SEGMENTS = new Set([
  "node_modules",
  "target",
  "dist",
  ".vite",
  ".git",
  "bin",
  "build",
  "obj",
  "out",
  "logs",
  "tmp",
  "dump",
]);
/** Hard cap on indexed paths across the whole workspace (tracked files first). */
const MAX_INDEX_FILES = 60_000;
/** Cap on paths handed to the backend symbol scan per root (its own scan is
 *  bounded too, but shipping 100k+ paths over IPC is a waste on asset-heavy
 *  projects). */
const MAX_SYMBOL_SCAN_PATHS = 20_000;

function pruneIndexFiles(files: string[]): string[] {
  return files.filter(
    (relative) => !relative.split("/").some((segment) => INDEX_PRUNE_SEGMENTS.has(segment)),
  );
}

export const useFileIndexStore = create<FileIndexState>((set, get) => ({
  roots: [],
  files: [],
  folders: [],
  symbols: [],
  rules: [],
  indexed: false,
  loading: false,
  error: null,

  ensureIndexed: async (roots) => {
    const state = get();
    if (sameRoots(state.roots, roots) && state.indexed && !state.loading) {
      return state.files;
    }
    if (sameRoots(state.roots, roots) && state.loading) return state.files;
    return get().refresh(roots);
  },

  refresh: async (roots) => {
    set({
      loading: true,
      error: null,
      roots,
      indexed: false,
    });
    const seen = new Set<string>();
    const files: string[] = [];
    const rules: ProjectRuleInfo[] = [];
    const symbols: ProjectSymbol[] = [];
    try {
      for (const root of roots) {
        const raw = await ipc.gitExecReadonly(root, [
          "ls-files",
          "-co",
          "--exclude-standard",
        ]);
        const relativeFiles = pruneIndexFiles(
          raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((relative) => relative.replace(/\\/g, "/")),
        );
        for (const relative of relativeFiles) {
          const absolute = joinRoot(root, relative);
          if (!seen.has(absolute)) {
            seen.add(absolute);
            files.push(absolute);
          }
          if (files.length >= MAX_INDEX_FILES) break;
        }
        rules.push(...discoverRules(root, relativeFiles));
        // Symbols come back with root-relative paths; rebase to absolute so
        // every workspace root can be disambiguated. Cap what we send: the
        // backend scan is bounded anyway, and huge path lists only cost IPC.
        const rootSymbols = await ipc.projectSymbols(
          root,
          relativeFiles.slice(0, MAX_SYMBOL_SCAN_PATHS),
        );
        for (const symbol of rootSymbols) {
          symbols.push({
            ...symbol,
            path: joinRoot(root, symbol.path),
          });
        }
      }
      if (files.length > MAX_INDEX_FILES) files.length = MAX_INDEX_FILES;
      const folders = collectFolders(files);
      if (!sameRoots(get().roots, roots)) return files;
      set({ files, folders, rules, symbols, indexed: true, loading: false, error: null });
      return files;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sameRoots(get().roots, roots)) {
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
      roots: [],
      files: [],
      folders: [],
      symbols: [],
      rules: [],
      indexed: false,
      loading: false,
      error: null,
    }),
}));
