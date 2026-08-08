import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { flushPendingEditorChanges } from "@/lib/editorCommands";
import { persistEditorRecovery } from "@/lib/editorRecovery";
import { useAgentStore } from "@/lib/stores/agentStore";
import { isEditorTabDirty, useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";
import { requestUnsavedDecision } from "@/lib/unsavedChanges";

function samePath(first: string, second: string) {
  const normalize = (path: string) =>
    path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/$/, "");
  return normalize(first) === normalize(second);
}

async function stopProjectAgents(projectPath: string) {
  const state = useAgentStore.getState();
  const ids = state.liveSessions
    .filter((session) => session.projectPath === projectPath)
    .map((session) => session.archiveId);
  await Promise.all(ids.map((id) => state.closeLiveSession(id)));
}

/**
 * Leaving a workspace destroys its editor tabs, so unsaved work needs a home
 * first. With a project open the dirty buffers are snapshotted (hot exit) and
 * restored when the project is next opened. In loose-file mode there is no
 * snapshot key, so each dirty file gets a save/discard/cancel decision.
 * Returns false when the user cancelled — the caller must not proceed.
 */
async function protectDirtyEditors(): Promise<boolean> {
  flushPendingEditorChanges();
  if (!useEditorStore.getState().tabs.some(isEditorTabDirty)) return true;

  const projectPath = useProjectStore.getState().current?.path;
  if (projectPath) return persistEditorRecovery(projectPath);

  const decided = new Set<string>();
  while (true) {
    const tab = useEditorStore
      .getState()
      .tabs.find((item) => isEditorTabDirty(item) && !decided.has(item.path));
    if (!tab) return true;
    const decision = await requestUnsavedDecision(tab.name);
    if (decision === "cancel") return false;
    if (decision === "save") {
      if (!(await useEditorStore.getState().saveTab(tab.path))) return false;
    }
    decided.add(tab.path);
  }
}

export async function pickProject(dialogTitle: string) {
  const path = await openDialog({ directory: true, title: dialogTitle });
  if (typeof path !== "string") return;
  await openProjectPath(path);
}

/** Open one text/source file without implicitly turning its parent into a project. */
export async function pickFile(dialogTitle: string) {
  const path = await openDialog({ directory: false, multiple: false, title: dialogTitle });
  if (typeof path !== "string") return;

  await openFilePath(path);
}

export async function openFilePath(path: string) {
  await useEditorStore.getState().openFile(path);
  const opened = useEditorStore
    .getState()
    .tabs.some((tab) => samePath(tab.path, path));
  if (opened) {
    const ui = useUiStore.getState();
    ui.closeSettings();
    ui.showWorkspace("editor");
  }
  return opened;
}

/** Open a project requested by a dialog, the CLI, or an OS shell action. */
export async function openProjectPath(path: string) {
  return openWorkspacePaths([path]);
}

/** Open a multi-folder workspace (from a `.glyphra-workspace` launch). */
export async function openWorkspacePaths(paths: string[]) {
  if (paths.length === 0) return false;
  const current = useProjectStore.getState().current;
  if (current && paths.length === 1 && samePath(current.path, paths[0]!)) return true;
  if (!(await protectDirtyEditors())) return false;
  if (current) await stopProjectAgents(current.path);
  else if (useEditorStore.getState().tabs.length > 0) {
    // Moving from loose-file mode into a folder is an explicit workspace
    // transition. Clear the standalone tabs after the dirty-file guard above.
    await useProjectStore.getState().closeProject();
  }
  await useProjectStore.getState().openWorkspace(paths);
  const opened = useProjectStore.getState();
  return paths.every((path) => opened.roots.some((root) => samePath(root.path, path)));
}

/** Add another folder to the current workspace (VSCode "Add Folder to Workspace"). */
export async function addFolderToWorkspace(dialogTitle: string) {
  const current = useProjectStore.getState().current;
  if (!current) {
    await pickProject(dialogTitle);
    return;
  }
  const path = await openDialog({ directory: true, title: dialogTitle });
  if (typeof path !== "string") return;
  await useProjectStore.getState().addFolder(path);
}

export async function closeCurrentProject() {
  const current = useProjectStore.getState().current;
  if (!current) return;
  if (!(await protectDirtyEditors())) return;
  await stopProjectAgents(current.path);
  await useProjectStore.getState().closeProject();
  useTerminalStore.getState().setOpen(false);
  useUiStore.getState().setAgentOpen(false);
  useUiStore.getState().showWorkspace("editor");
  useUiStore.getState().closeSettings();
}
