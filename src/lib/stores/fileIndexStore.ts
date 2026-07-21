import { create } from "zustand";

import { ipc } from "@/lib/ipc/ipc";

interface FileIndexState {
  projectPath: string | null;
  files: string[];
  loading: boolean;
  error: string | null;
  ensureIndexed: (projectPath: string) => Promise<string[]>;
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

export const useFileIndexStore = create<FileIndexState>((set, get) => ({
  projectPath: null,
  files: [],
  loading: false,
  error: null,

  ensureIndexed: async (projectPath) => {
    const state = get();
    if (state.projectPath === projectPath && state.files.length > 0 && !state.loading) {
      return state.files;
    }
    set({ loading: true, error: null, projectPath });
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
      set({ files: unique, loading: false, error: null });
      return unique;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ files: [], loading: false, error: message });
      return [];
    }
  },

  clear: () => set({ projectPath: null, files: [], loading: false, error: null }),
}));

export function absoluteFromIndex(projectPath: string, relative: string) {
  return joinProject(projectPath, relative);
}
