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

export interface OpenFileOptions {
  /** 1-based line to reveal after open. */
  line?: number;
  /** 1-based column (defaults to 1). */
  column?: number;
  /** Force re-read from disk even if the tab is already open (clean tabs only). */
  reload?: boolean;
}

export interface EditorReveal {
  path: string;
  line: number;
  column: number;
  token: number;
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  loading: boolean;
  error: string | null;
  reveal: EditorReveal | null;
  openFile: (path: string, options?: OpenFileOptions) => Promise<void>;
  confirmLeaveActive: () => Promise<boolean>;
  activateTab: (path: string) => Promise<void>;
  closeTab: (path: string) => Promise<void>;
  setContent: (path: string, content: string) => void;
  saveTab: (path: string) => Promise<boolean>;
  saveActive: () => Promise<void>;
  /** Reload clean open tabs whose paths appear in `paths` (absolute). */
  syncFromDisk: (paths: string[]) => Promise<void>;
  clearReveal: (token?: number) => void;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function tabFromRead(file: Awaited<ReturnType<typeof ipc.fsRead>>): EditorTab {
  const degrade = file.truncated || file.longLines;
  return {
    path: file.path,
    name: basename(file.path),
    content: file.content,
    savedContent: file.content,
    hash: file.hash,
    truncated: file.truncated,
    longLines: file.longLines,
    readOnly: file.readOnly || degrade,
  };
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

let revealToken = 0;

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  loading: false,
  error: null,
  reveal: null,

  openFile: async (path, options) => {
    const existing = get().tabs.find((tab) => tab.path === path);
    const line = options?.line;
    const column = options?.column ?? 1;

    const queueReveal = () => {
      if (line == null || line < 1) return;
      revealToken += 1;
      set({
        reveal: { path, line, column: Math.max(1, column), token: revealToken },
      });
    };

    if (existing) {
      if (options?.reload && existing.content === existing.savedContent) {
        try {
          const file = await ipc.fsRead(path);
          if (file.hash !== existing.hash || file.content !== existing.savedContent) {
            set((state) => ({
              tabs: state.tabs.map((tab) => (tab.path === path ? tabFromRead(file) : tab)),
            }));
          }
        } catch (error) {
          set({ error: asMessage(error) });
        }
      }
      await get().activateTab(path);
      queueReveal();
      return;
    }

    const activePath = get().activePath;
    if (activePath && !(await prepareToLeave(activePath))) return;

    set({ loading: true, error: null });
    try {
      const file = await ipc.fsRead(path);
      const tab = tabFromRead(file);
      set((state) => ({ tabs: [...state.tabs, tab], activePath: tab.path, loading: false }));
      queueReveal();
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

  syncFromDisk: async (paths) => {
    const wanted = new Set(paths.map(normalizePath));
    if (wanted.size === 0) return;

    const candidates = get().tabs.filter(
      (tab) =>
        wanted.has(normalizePath(tab.path)) && tab.content === tab.savedContent && !tab.readOnly,
    );
    if (candidates.length === 0) return;

    await Promise.all(
      candidates.map(async (tab) => {
        try {
          const file = await ipc.fsRead(tab.path);
          if (file.hash === tab.hash && file.content === tab.savedContent) return;
          set((state) => ({
            tabs: state.tabs.map((item) => {
              if (item.path !== tab.path) return item;
              // Skip if the user dirtied the tab while we were reading.
              if (item.content !== item.savedContent) return item;
              return tabFromRead(file);
            }),
          }));
        } catch {
          // File disappeared — close the tab only when it was still clean.
          set((state) => {
            const current = state.tabs.find((item) => item.path === tab.path);
            if (!current || current.content !== current.savedContent) return state;
            const tabs = state.tabs.filter((item) => item.path !== tab.path);
            return {
              tabs,
              activePath:
                state.activePath === tab.path ? tabs.at(-1)?.path ?? null : state.activePath,
            };
          });
        }
      }),
    );
  },

  clearReveal: (token) => {
    set((state) => {
      if (token != null && state.reveal?.token !== token) return state;
      return { reveal: null };
    });
  },
}));
