import { create } from "zustand";

import { ipc, type DirEntryInfo, type ProjectInfo, type RecentProject } from "@/lib/ipc/ipc";

interface ProjectState {
  current: ProjectInfo | null;
  recents: RecentProject[];
  entries: DirEntryInfo[];
  watcherId: number | null;
  loading: boolean;
  error: string | null;
  loadRecents: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  listCurrentRoot: () => Promise<void>;
  stopWatcher: () => Promise<void>;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  current: null,
  recents: [],
  entries: [],
  watcherId: null,
  loading: false,
  error: null,

  loadRecents: async () => {
    try {
      set({ recents: await ipc.projectRecent() });
    } catch (error) {
      set({ error: asMessage(error) });
    }
  },

  openProject: async (path) => {
    set({ loading: true, error: null });
    try {
      await get().stopWatcher();
      const current = await ipc.projectOpen(path);
      set({ current, loading: false });
      await Promise.all([get().listCurrentRoot(), get().loadRecents()]);
      const watcherId = await ipc.fsWatchStart(current.path, () => void get().listCurrentRoot());
      set({ watcherId });
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  listCurrentRoot: async () => {
    const { current } = get();
    if (!current) return;
    set({ loading: true, error: null });
    try {
      const entries = await ipc.fsList(current.path);
      set({ entries, loading: false });
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  stopWatcher: async () => {
    const { watcherId } = get();
    if (watcherId === null) return;
    await ipc.fsWatchStop(watcherId);
    set({ watcherId: null });
  },
}));
