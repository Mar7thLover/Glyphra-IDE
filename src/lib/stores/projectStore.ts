import { create } from "zustand";

import { ipc, type DirEntryInfo, type FsEvent, type ProjectInfo, type RecentProject } from "@/lib/ipc/ipc";
import { useGitStore } from "@/lib/stores/gitStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useReviewStore } from "@/lib/stores/reviewStore";

const WATCH_DEBOUNCE_MS = 300;

interface ProjectState {
  current: ProjectInfo | null;
  recents: RecentProject[];
  entries: DirEntryInfo[];
  /** Expanded directory → children. Patched on watch events. */
  children: Record<string, DirEntryInfo[]>;
  expanded: string[];
  watcherId: number | null;
  loading: boolean;
  error: string | null;
  loadRecents: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  closeProject: () => Promise<void>;
  listCurrentRoot: () => Promise<void>;
  toggleDirectory: (entry: DirEntryInfo) => Promise<void>;
  stopWatcher: () => Promise<void>;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parentDir(path: string) {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

/** Collect project root + every expanded ancestor that may own a changed path. */
function dirsToRefresh(projectRoot: string, event: FsEvent, expanded: string[]) {
  const targets = new Set<string>([projectRoot]);
  const expandedSet = new Set(expanded);

  for (const path of event.paths) {
    let dir = parentDir(path) ?? projectRoot;
    for (let i = 0; i < 64 && dir; i++) {
      if (dir === projectRoot || expandedSet.has(dir)) targets.add(dir);
      if (dir === projectRoot) break;
      const next = parentDir(dir);
      if (!next || next === dir) break;
      dir = next;
    }
  }
  return [...targets];
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEvent: FsEvent | null = null;
let refreshInFlight: Promise<void> | null = null;
let queuedEvent: FsEvent | null = null;

const IGNORED_WATCH_SEGMENTS = new Set([".git", "node_modules", "target", "dist", ".vite"]);

function relevantEvent(event: FsEvent, projectRoot: string): FsEvent | null {
  const root = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const paths = event.paths.filter((path) => {
    const normalized = path.replace(/\\/g, "/");
    const relative = normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
    return !relative.split("/").some((segment) => IGNORED_WATCH_SEGMENTS.has(segment));
  });
  return paths.length > 0 ? { ...event, paths } : null;
}

function enqueueRefresh(event: FsEvent) {
  if (refreshInFlight) {
    queuedEvent = event;
    return;
  }
  refreshInFlight = refreshFromEvent(event).finally(() => {
    refreshInFlight = null;
    const next = queuedEvent;
    queuedEvent = null;
    if (next) enqueueRefresh(next);
  });
}

function clearProjectScopedStores() {
  useEditorStore.setState({ tabs: [], activePath: null, loading: false, error: null });
  useGitStore.setState({ statuses: {} });
  useReviewStore.setState({
    projectPath: null,
    turns: [],
    workingTree: [],
    summaries: {},
    decisions: {},
    activeTurnId: null,
    activeFile: null,
    contents: null,
    open: false,
    loading: false,
    error: null,
  });
}

async function refreshFromEvent(event: FsEvent) {
  const { current, expanded } = useProjectStore.getState();
  if (!current) return;

  const targets = dirsToRefresh(current.path, event, expanded);
  const nextChildren: Record<string, DirEntryInfo[]> = {
    ...useProjectStore.getState().children,
  };
  let nextEntries = useProjectStore.getState().entries;
  const missing = new Set<string>();

  await Promise.all(
    targets.map(async (dir) => {
      try {
        const listed = await ipc.fsList(dir);
        if (dir === current.path) nextEntries = listed;
        else nextChildren[dir] = listed;
      } catch {
        missing.add(dir);
        delete nextChildren[dir];
      }
    }),
  );

  // Drop only directories we failed to re-list (deleted/moved). Keep other
  // expansions so nested watches don't collapse the tree.
  const nextExpanded = expanded.filter((path) => !missing.has(path));
  for (const path of Object.keys(nextChildren)) {
    if (!nextExpanded.includes(path)) delete nextChildren[path];
  }

  useProjectStore.setState({
    entries: nextEntries,
    children: nextChildren,
    expanded: nextExpanded,
    error: null,
  });
  void useGitStore.getState().refresh(current.path);
  void useReviewStore.getState().refreshWorkingTree(current.path);
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  current: null,
  recents: [],
  entries: [],
  children: {},
  expanded: [],
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
    set({ loading: true, error: null, children: {}, expanded: [] });
    try {
      const previousPath = get().current?.path;
      await get().stopWatcher();
      const current = await ipc.projectOpen(path);
      if (previousPath && previousPath !== current.path) clearProjectScopedStores();
      set({ current, loading: false });
      await Promise.all([get().listCurrentRoot(), get().loadRecents()]);

      const watcherId = await ipc.fsWatchStart(current.path, (event) => {
        const relevant = relevantEvent(event, current.path);
        if (!relevant) return;
        pendingEvent = relevant;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const latest = pendingEvent;
          pendingEvent = null;
          debounceTimer = null;
          if (!latest) return;
          enqueueRefresh(latest);
        }, WATCH_DEBOUNCE_MS);
      });
      set({ watcherId });
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  closeProject: async () => {
    try {
      await get().stopWatcher();
    } finally {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      pendingEvent = null;
      queuedEvent = null;
      set({
        current: null,
        entries: [],
        children: {},
        expanded: [],
        watcherId: null,
        loading: false,
        error: null,
      });
      clearProjectScopedStores();
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

  toggleDirectory: async (entry) => {
    if (entry.kind !== "directory") return;
    const { expanded, children } = get();

    if (expanded.includes(entry.path)) {
      set({ expanded: expanded.filter((path) => path !== entry.path) });
      return;
    }

    if (!children[entry.path]) {
      const listed = await ipc.fsList(entry.path);
      set((state) => ({
        children: { ...state.children, [entry.path]: listed },
      }));
    }
    set((state) => ({ expanded: [...state.expanded, entry.path] }));
  },

  stopWatcher: async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      pendingEvent = null;
    }
    const { watcherId } = get();
    if (watcherId === null) return;
    await ipc.fsWatchStop(watcherId);
    set({ watcherId: null });
  },
}));
