import { create } from "zustand";

import { ipc } from "@/lib/ipc/ipc";

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  hash: string;
  truncated: boolean;
  readOnly: boolean;
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  loading: boolean;
  error: string | null;
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  setContent: (path: string, content: string) => void;
  saveActive: () => Promise<void>;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  loading: false,
  error: null,

  openFile: async (path) => {
    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      set({ activePath: path, error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const file = await ipc.fsRead(path);
      const tab: EditorTab = {
        path: file.path,
        name: basename(file.path),
        content: file.content,
        savedContent: file.content,
        hash: file.hash,
        truncated: file.truncated,
        readOnly: file.readOnly || file.truncated,
      };
      set((state) => ({ tabs: [...state.tabs, tab], activePath: tab.path, loading: false }));
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  closeTab: (path) => {
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.path !== path);
      const activePath = state.activePath === path ? tabs.at(-1)?.path ?? null : state.activePath;
      return { tabs, activePath };
    });
  },

  setContent: (path, content) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, content } : tab)),
    }));
  },

  saveActive: async () => {
    const active = get().tabs.find((tab) => tab.path === get().activePath);
    if (!active || active.readOnly || active.content === active.savedContent) return;

    set({ loading: true, error: null });
    try {
      const result = await ipc.fsWrite(active.path, active.content, active.hash);
      set((state) => ({
        loading: false,
        tabs: state.tabs.map((tab) =>
          tab.path === active.path
            ? { ...tab, hash: result.hash, savedContent: active.content }
            : tab,
        ),
      }));
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },
}));
