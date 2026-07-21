import { create } from "zustand";

import { ipc } from "@/lib/ipc/ipc";
import { requestUnsavedDecision } from "@/lib/unsavedChanges";

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  hash: string;
  truncated: boolean;
  longLines: boolean;
  readOnly: boolean;
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  loading: boolean;
  error: string | null;
  openFile: (path: string) => Promise<void>;
  confirmLeaveActive: () => Promise<boolean>;
  activateTab: (path: string) => Promise<void>;
  closeTab: (path: string) => Promise<void>;
  setContent: (path: string, content: string) => void;
  saveTab: (path: string) => Promise<boolean>;
  saveActive: () => Promise<void>;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function prepareToLeave(path: string): Promise<boolean> {
  const tab = useEditorStore.getState().tabs.find((item) => item.path === path);
  if (!tab || tab.content === tab.savedContent) return true;

  const decision = await requestUnsavedDecision(tab.name);
  if (decision === "cancel") return false;
  if (decision === "save") return useEditorStore.getState().saveTab(path);

  useEditorStore.setState((state) => ({
    tabs: state.tabs.map((item) =>
      item.path === path ? { ...item, content: item.savedContent } : item,
    ),
  }));
  return true;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  loading: false,
  error: null,

  openFile: async (path) => {
    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      await get().activateTab(path);
      return;
    }

    const activePath = get().activePath;
    if (activePath && !(await prepareToLeave(activePath))) return;

    set({ loading: true, error: null });
    try {
      const file = await ipc.fsRead(path);
      const degrade = file.truncated || file.longLines;
      const tab: EditorTab = {
        path: file.path,
        name: basename(file.path),
        content: file.content,
        savedContent: file.content,
        hash: file.hash,
        truncated: file.truncated,
        longLines: file.longLines,
        readOnly: file.readOnly || degrade,
      };
      set((state) => ({ tabs: [...state.tabs, tab], activePath: tab.path, loading: false }));
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  activateTab: async (path) => {
    const activePath = get().activePath;
    if (activePath === path) return;
    if (activePath && !(await prepareToLeave(activePath))) return;
    if (get().tabs.some((tab) => tab.path === path)) set({ activePath: path, error: null });
  },

  confirmLeaveActive: async () => {
    const activePath = get().activePath;
    return activePath ? prepareToLeave(activePath) : true;
  },

  closeTab: async (path) => {
    if (!(await prepareToLeave(path))) return;
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

  saveTab: async (path) => {
    const active = get().tabs.find((tab) => tab.path === path);
    if (!active || active.readOnly || active.content === active.savedContent) return true;

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
      return true;
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
      return false;
    }
  },

  saveActive: async () => {
    const activePath = get().activePath;
    if (activePath) await get().saveTab(activePath);
  },
}));
