import { create } from "zustand";

import { ipc } from "@/lib/ipc/ipc";

interface GitState {
  /** relative path → porcelain XY */
  statuses: Record<string, string>;
  refresh: (projectPath: string) => Promise<void>;
  badgeFor: (projectPath: string, absolutePath: string) => string | null;
}

function toRel(projectPath: string, absolutePath: string): string {
  const root = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const full = absolutePath.replace(/\\/g, "/");
  if (full.startsWith(root + "/")) return full.slice(root.length + 1);
  return full;
}

export const useGitStore = create<GitState>((set, get) => ({
  statuses: {},

  refresh: async (projectPath) => {
    try {
      const entries = await ipc.gitStatus(projectPath);
      const statuses: Record<string, string> = {};
      for (const entry of entries) {
        statuses[entry.path.replace(/\\/g, "/")] = entry.status.trim() || entry.status;
      }
      set({ statuses });
    } catch {
      set({ statuses: {} });
    }
  },

  badgeFor: (projectPath, absolutePath) => {
    const rel = toRel(projectPath, absolutePath);
    return get().statuses[rel] ?? null;
  },
}));
