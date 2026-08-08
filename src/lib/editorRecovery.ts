import { flushPendingEditorChanges } from "@/lib/editorCommands";
import {
  ipc,
  type EditorRecoverySnapshot,
  type EditorRecoveryTab,
  type FileReadResult,
} from "@/lib/ipc/ipc";
import {
  detectEol,
  isEditorTabDirty,
  isUntitledPath,
  normalizeEol,
  untitledLabel,
  type EditorTab,
} from "@/lib/stores/editorStore";
import { useEditorStore } from "@/lib/stores/editorStore";

export const EDITOR_RECOVERY_INTERVAL_MS = 2_000;

const flushes = new Map<string, Promise<boolean>>();

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function createRecoverySnapshot(
  projectPath: string,
  tabs: EditorTab[],
  activePath: string | null,
  savedAt = Date.now(),
): EditorRecoverySnapshot | null {
  const dirty: EditorRecoveryTab[] = tabs
    .filter(isEditorTabDirty)
    .map((tab) => ({
      path: tab.path,
      content: tab.content,
      baseHash: tab.hash,
      encoding: tab.encoding,
      bom: tab.bom,
    }));
  if (dirty.length === 0) return null;
  return {
    projectPath,
    activePath: activePath && dirty.some((tab) => tab.path === activePath) ? activePath : null,
    savedAt,
    tabs: dirty,
  };
}

async function writeCurrentRecovery(projectPath: string): Promise<boolean> {
  // Pull any debounced keystrokes into the store first, or the snapshot can
  // miss the last ~140ms of typing before a crash or forced close.
  flushPendingEditorChanges();
  const state = useEditorStore.getState();
  const snapshot = createRecoverySnapshot(projectPath, state.tabs, state.activePath);
  try {
    if (snapshot) await ipc.editorRecoverySave(snapshot);
    else await ipc.editorRecoveryClear(projectPath);
    return true;
  } catch (error) {
    if (snapshot) {
      useEditorStore.setState({
        error: `Unable to protect unsaved buffers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return false;
    }
    return true;
  }
}

/** Serialize writes per project so an older interval cannot replace a newer snapshot. */
export function persistEditorRecovery(projectPath: string): Promise<boolean> {
  const previous = flushes.get(projectPath) ?? Promise.resolve(true);
  const next = previous
    .catch(() => false)
    .then(() => writeCurrentRecovery(projectPath))
    .finally(() => {
      if (flushes.get(projectPath) === next) flushes.delete(projectPath);
    });
  flushes.set(projectPath, next);
  return next;
}

function recoveredTab(
  recovery: EditorRecoveryTab,
  disk: FileReadResult | null,
): { tab: EditorTab; conflict: boolean } {
  if (!disk) {
    const content = normalizeEol(recovery.content);
    return {
      tab: {
        path: recovery.path,
        name: isUntitledPath(recovery.path)
          ? untitledLabel(recovery.path)
          : basename(recovery.path),
        content,
        savedContent: "",
        hash: "",
        truncated: false,
        longLines: false,
        readOnly: false,
        lossy: false,
        encoding: recovery.encoding ?? "UTF-8",
        savedEncoding: recovery.encoding ?? "UTF-8",
        bom: recovery.bom ?? false,
        savedBom: recovery.bom ?? false,
        eol: detectEol(recovery.content),
        savedEol: detectEol(recovery.content),
      },
      conflict: recovery.baseHash !== "",
    };
  }
  const diskEol = detectEol(disk.content);
  return {
    tab: {
      path: disk.path,
      name: basename(disk.path),
      content: normalizeEol(recovery.content),
      savedContent: normalizeEol(disk.content),
      hash: disk.hash,
      truncated: disk.truncated,
      longLines: disk.longLines,
      readOnly: disk.readOnly || disk.truncated || disk.longLines || disk.lossy,
      lossy: disk.lossy,
      encoding: recovery.encoding ?? disk.encoding,
      savedEncoding: disk.encoding,
      bom: recovery.bom ?? disk.bom,
      savedBom: disk.bom,
      eol: diskEol,
      savedEol: diskEol,
    },
    conflict: recovery.baseHash !== disk.hash,
  };
}

export async function restoreEditorRecovery(
  projectPath: string,
  shouldApply: () => boolean = () => true,
): Promise<number> {
  let snapshot: EditorRecoverySnapshot | null;
  try {
    snapshot = await ipc.editorRecoveryLoad(projectPath);
  } catch (error) {
    useEditorStore.setState({
      error: `Unable to load recovery snapshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return 0;
  }
  if (!snapshot || snapshot.tabs.length === 0) return 0;

  const hydrated = await Promise.all(
    snapshot.tabs.map(async (tab) => {
      try {
        return recoveredTab(tab, await ipc.fsRead(tab.path));
      } catch {
        return recoveredTab(tab, null);
      }
    }),
  );
  const useful = hydrated.filter(({ tab }) => isEditorTabDirty(tab));
  if (useful.length === 0) {
    await ipc.editorRecoveryClear(projectPath).catch(() => undefined);
    return 0;
  }
  if (!shouldApply()) return 0;

  let restoredCount = 0;
  useEditorStore.setState((state) => {
    const tabs = [...state.tabs];
    let restored = 0;
    let conflicts = 0;
    for (const item of useful) {
      const index = tabs.findIndex((tab) => tab.path === item.tab.path);
      if (index >= 0 && isEditorTabDirty(tabs[index])) continue;
      if (index >= 0) tabs[index] = item.tab;
      else tabs.push(item.tab);
      restored += 1;
      if (item.conflict) conflicts += 1;
    }
    restoredCount = restored;
    const recoveredActive = snapshot.activePath
      ? tabs.find((tab) => tab.path === snapshot.activePath)?.path
      : undefined;
    return {
      tabs,
      activePath: recoveredActive ?? state.activePath ?? useful[0]?.tab.path ?? null,
      primaryPath:
        recoveredActive ?? state.primaryPath ?? state.activePath ?? useful[0]?.tab.path ?? null,
      secondaryPath: null,
      focusedPane: "primary" as const,
      recoveryNotice:
        restored > 0
          ? { count: restored, conflicts, savedAt: snapshot.savedAt }
          : state.recoveryNotice,
    };
  });
  return restoredCount;
}
