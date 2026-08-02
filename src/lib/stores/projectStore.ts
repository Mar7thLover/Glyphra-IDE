import { create } from "zustand";

import { ipc, type DirEntryInfo, type FsEvent, type ProjectInfo, type RecentProject } from "@/lib/ipc/ipc";
import { useGitStore } from "@/lib/stores/gitStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { useFileIndexStore } from "@/lib/stores/fileIndexStore";
import { useReviewStore } from "@/lib/stores/reviewStore";

const WATCH_DEBOUNCE_MS = 300;

interface ProjectState {
  /** Primary workspace root. Agent sessions, checkpoints, git and recovery all key off this. */
  current: ProjectInfo | null;
  /** Ordered workspace roots; `roots[0]` is always `current`. */
  roots: ProjectInfo[];
  recents: RecentProject[];
  /** Root path → root-level listing. */
  entriesByRoot: Record<string, DirEntryInfo[]>;
  /** Expanded directory → children. Patched on watch events. */
  children: Record<string, DirEntryInfo[]>;
  expanded: string[];
  /** Root path → active fs watcher id. */
  watcherIds: Record<string, number | null>;
  loading: boolean;
  error: string | null;
  loadRecents: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  openWorkspace: (paths: string[]) => Promise<void>;
  addFolder: (path: string) => Promise<ProjectInfo | null>;
  removeFolder: (path: string) => Promise<void>;
  closeProject: () => Promise<void>;
  listRoot: (path: string) => Promise<void>;
  toggleDirectory: (entry: DirEntryInfo) => Promise<void>;
  stopWatcher: (rootPath?: string) => Promise<void>;
  rootForFile: (path: string) => string | null;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function normalizePath(path: string) {
  return path
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function parentDir(path: string) {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

/** Collect a root + every expanded ancestor that may own a changed path. */
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
let pendingEvent: { root: string; event: FsEvent } | null = null;
let refreshInFlight: Promise<void> | null = null;
let queuedEvent: { root: string; event: FsEvent } | null = null;

const IGNORED_WATCH_SEGMENTS = new Set([".git", "node_modules", "target", "dist", ".vite"]);

function relevantEvent(event: FsEvent, root: string): FsEvent | null {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const paths = event.paths.filter((path) => {
    const normalized = path.replace(/\\/g, "/");
    const relative = normalized.startsWith(`${normalizedRoot}/`)
      ? normalized.slice(normalizedRoot.length + 1)
      : normalized;
    return !relative.split("/").some((segment) => IGNORED_WATCH_SEGMENTS.has(segment));
  });
  return paths.length > 0 ? { ...event, paths } : null;
}

function enqueueRefresh(payload: { root: string; event: FsEvent }) {
  if (refreshInFlight) {
    queuedEvent = payload;
    return;
  }
  refreshInFlight = refreshFromEvent(payload).finally(() => {
    refreshInFlight = null;
    const next = queuedEvent;
    queuedEvent = null;
    if (next) enqueueRefresh(next);
  });
}

function clearProjectScopedStores() {
  useDiagnosticsStore.getState().clearAll();
  useDiagnosticsStore.getState().setProblemsOpen(false);
  useEditorStore.setState({
    tabs: [],
    activePath: null,
    primaryPath: null,
    secondaryPath: null,
    focusedPane: "primary",
    loading: false,
    error: null,
    reveal: null,
    cursor: null,
    docInfo: null,
    recoveryNotice: null,
  });
  useGitStore.setState({ statuses: {}, branch: null });
  useFileIndexStore.getState().clear();
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

async function refreshFromEvent({ root, event }: { root: string; event: FsEvent }) {
  const { expanded, roots } = useProjectStore.getState();
  if (!root || !roots.some((item) => normalizePath(item.path) === normalizePath(root))) return;

  const targets = dirsToRefresh(root, event, expanded);
  const nextChildren: Record<string, DirEntryInfo[]> = {
    ...useProjectStore.getState().children,
  };
  let nextEntries = useProjectStore.getState().entriesByRoot[root];
  const missing = new Set<string>();

  await Promise.all(
    targets.map(async (dir) => {
      try {
        const listed = await ipc.fsList(dir);
        if (normalizePath(dir) === normalizePath(root)) nextEntries = listed;
        else nextChildren[dir] = listed;
      } catch {
        missing.add(dir);
        delete nextChildren[dir];
      }
    }),
  );

  const nextExpanded = expanded.filter((path) => !missing.has(path));
  for (const path of Object.keys(nextChildren)) {
    if (!nextExpanded.includes(path)) delete nextChildren[path];
  }

  useProjectStore.setState({
    entriesByRoot: { ...useProjectStore.getState().entriesByRoot, [root]: nextEntries },
    children: nextChildren,
    expanded: nextExpanded,
    error: null,
  });
  const primary = useProjectStore.getState().current?.path;
  if (primary) {
    void useGitStore.getState().refresh(primary);
    void useReviewStore.getState().refreshWorkingTree(primary);
  }
  // Agent (and other) writers must refresh clean open tabs so the editor
  // never silently overwrites disk with a stale buffer.
  void useEditorStore.getState().syncFromDisk(event.paths);
}

async function startRootWatcher(rootPath: string) {
  const watcherId = await ipc.fsWatchStart(rootPath, (event) => {
    const relevant = relevantEvent(event, rootPath);
    if (!relevant) return;
    pendingEvent = { root: rootPath, event: relevant };
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const latest = pendingEvent;
      pendingEvent = null;
      debounceTimer = null;
      if (!latest) return;
      enqueueRefresh(latest);
    }, WATCH_DEBOUNCE_MS);
  });
  useProjectStore.setState((state) => ({
    watcherIds: { ...state.watcherIds, [rootPath]: watcherId },
  }));
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  current: null,
  roots: [],
  recents: [],
  entriesByRoot: {},
  children: {},
  expanded: [],
  watcherIds: {},
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
    await get().openWorkspace([path]);
  },

  openWorkspace: async (paths) => {
    const unique = [...new Set(paths.map((path) => path.replace(/\\/g, "/")))];
    if (unique.length === 0) return;
    set({ loading: true, error: null });
    try {
      const previousPath = get().current?.path;
      await get().stopWatcher();
      const opened = await Promise.all(unique.map((path) => ipc.projectOpen(path)));
      const primaryChanged =
        previousPath != null && !opened.some((info) => normalizePath(info.path) === normalizePath(previousPath));
      if (primaryChanged) clearProjectScopedStores();
      set({
        current: opened[0],
        roots: opened,
        entriesByRoot: {},
        children: {},
        expanded: [],
        loading: false,
        watcherIds: {},
      });
      await Promise.all(opened.map((info) => get().listRoot(info.path)));
      await get().loadRecents();
      // Warm the shared Ctrl+P/composer index across every root.
      void useFileIndexStore.getState().refresh(opened.map((info) => info.path));
      const primary = useProjectStore.getState().current?.path;
      if (primary) void useReviewStore.getState().refresh(primary);
      await Promise.all(opened.map((info) => startRootWatcher(info.path)));
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  addFolder: async (path) => {
    const { roots } = get();
    if (roots.some((info) => normalizePath(info.path) === normalizePath(path))) {
      return roots.find((info) => normalizePath(info.path) === normalizePath(path)) ?? null;
    }
    set({ loading: true, error: null });
    try {
      const info = await ipc.projectOpen(path);
      const nextRoots = [...roots, info];
      set({
        roots: nextRoots,
        entriesByRoot: { ...get().entriesByRoot, [info.path]: [] },
        loading: false,
      });
      await get().listRoot(info.path);
      await get().loadRecents();
      const rootPaths = nextRoots.map((root) => root.path);
      void useFileIndexStore.getState().refresh(rootPaths);
      await startRootWatcher(info.path);
      return info;
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
      return null;
    }
  },

  removeFolder: async (path) => {
    const { roots, current } = get();
    const index = roots.findIndex((info) => normalizePath(info.path) === normalizePath(path));
    if (index < 0) return;
    await get().stopWatcher(path);
    const removedPrimary = normalizePath(current?.path ?? "") === normalizePath(path);
    const nextRoots = roots.filter((_, itemIndex) => itemIndex !== index);
    if (nextRoots.length === 0) {
      await get().closeProject();
      return;
    }
    const entriesByRoot = { ...get().entriesByRoot };
    delete entriesByRoot[roots[index]!.path];
    const children = { ...get().children };
    for (const key of Object.keys(children)) {
      if (normalizePath(key).startsWith(`${normalizePath(path)}/`)) delete children[key];
    }
    const expanded = get().expanded.filter(
      (item) => !normalizePath(item).startsWith(`${normalizePath(path)}/`),
    );
    if (removedPrimary) {
      clearProjectScopedStores();
      set({
        current: nextRoots[0],
        roots: nextRoots,
        entriesByRoot,
        children,
        expanded,
        watcherIds: { ...get().watcherIds, [path]: null },
      });
      const rootPaths = nextRoots.map((root) => root.path);
      void useFileIndexStore.getState().refresh(rootPaths);
      if (nextRoots[0]) void useReviewStore.getState().refresh(nextRoots[0].path);
    } else {
      set({
        roots: nextRoots,
        entriesByRoot,
        children,
        expanded,
        watcherIds: { ...get().watcherIds, [path]: null },
      });
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
        roots: [],
        entriesByRoot: {},
        children: {},
        expanded: [],
        watcherIds: {},
        loading: false,
        error: null,
      });
      clearProjectScopedStores();
    }
  },

  listRoot: async (path) => {
    set({ loading: true, error: null });
    try {
      const entries = await ipc.fsList(path);
      set((state) => ({
        entriesByRoot: { ...state.entriesByRoot, [path]: entries },
        loading: false,
      }));
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

  stopWatcher: async (rootPath?: string) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      pendingEvent = null;
    }
    const { watcherIds } = get();
    const targets = rootPath
      ? watcherIds[rootPath] != null
        ? [[rootPath, watcherIds[rootPath]] as const]
        : []
      : Object.entries(watcherIds);
    const stopAll = targets.map(async ([root, watcherId]) => {
      if (watcherId == null) return;
      try {
        await ipc.fsWatchStop(watcherId);
      } catch {
        // A watcher may already be gone with its window.
      }
      useProjectStore.setState((state) => ({
        watcherIds: { ...state.watcherIds, [root]: null },
      }));
    });
    await Promise.all(stopAll);
  },

  rootForFile: (path) => {
    const normalized = normalizePath(path);
    for (const info of get().roots) {
      const root = normalizePath(info.path);
      if (normalized === root || normalized.startsWith(`${root}/`)) return info.path;
    }
    return null;
  },
}));

export function rootDisplayName(root: ProjectInfo): string {
  return root.name;
}
