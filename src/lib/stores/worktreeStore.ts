import { create } from "zustand";

import { ipc, type GitWorktree } from "@/lib/ipc/ipc";

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface WorktreeState {
  worktrees: GitWorktree[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Project the current list belongs to, so a project switch never shows stale rows. */
  projectPath: string | null;
  refresh: (projectPath: string) => Promise<void>;
  create: (projectPath: string, name: string) => Promise<GitWorktree | null>;
  remove: (projectPath: string, path: string, force?: boolean) => Promise<boolean>;
  clearError: () => void;
  reset: () => void;
}

export const useWorktreeStore = create<WorktreeState>((set, get) => ({
  worktrees: [],
  loading: false,
  busy: false,
  error: null,
  projectPath: null,

  refresh: async (projectPath) => {
    set({ loading: true, projectPath });
    try {
      const worktrees = await ipc.gitWorktreeList(projectPath);
      // A slower request for a project the user already left must not win.
      if (get().projectPath !== projectPath) return;
      set({ worktrees, loading: false, error: null });
    } catch (error) {
      if (get().projectPath !== projectPath) return;
      // Not every project is a git repository; an empty board is the honest
      // rendering, with the reason available if the user asks for it.
      set({ worktrees: [], loading: false, error: asMessage(error) });
    }
  },

  create: async (projectPath, name) => {
    set({ busy: true, error: null });
    try {
      const created = await ipc.gitWorktreeAdd(projectPath, name);
      const worktrees = await ipc.gitWorktreeList(projectPath);
      set({ worktrees, busy: false });
      return created;
    } catch (error) {
      set({ busy: false, error: asMessage(error) });
      return null;
    }
  },

  remove: async (projectPath, path, force = false) => {
    set({ busy: true, error: null });
    try {
      const worktrees = await ipc.gitWorktreeRemove(projectPath, path, force);
      set({ worktrees, busy: false });
      return true;
    } catch (error) {
      set({ busy: false, error: asMessage(error) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set({ worktrees: [], loading: false, busy: false, error: null, projectPath: null }),
}));
