import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { dirname } from "@tauri-apps/api/path";

import { useAgentStore } from "@/lib/stores/agentStore";
import { isEditorTabDirty, useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

function hasDirtyEditors() {
  return useEditorStore.getState().tabs.some(isEditorTabDirty);
}

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

export async function pickProject(dialogTitle: string, unsavedPrompt: string) {
  const path = await openDialog({ directory: true, title: dialogTitle });
  if (typeof path !== "string") return;
  await openProjectPath(path, unsavedPrompt);
}

/** Open one text/source file and use its parent directory as a temporary project. */
export async function pickFile(dialogTitle: string, unsavedPrompt: string) {
  const path = await openDialog({ directory: false, multiple: false, title: dialogTitle });
  if (typeof path !== "string") return;

  const opened = await openFilePath(path, unsavedPrompt);
  if (!opened) return;
}

export async function openFilePath(path: string, unsavedPrompt: string) {
  const projectPath = await dirname(path);
  const current = useProjectStore.getState().current;
  if (current && samePath(current.path, projectPath)) {
    await useEditorStore.getState().openFile(path);
    const normalizedPath = path.replace(/\\/g, "/");
    return useEditorStore
      .getState()
      .tabs.some((tab) => tab.path.replace(/\\/g, "/") === normalizedPath);
  }
  if (hasDirtyEditors() && !window.confirm(unsavedPrompt)) return false;
  if (current) await stopProjectAgents(current.path);
  await useProjectStore.getState().openProject(projectPath);
  const openedProject = useProjectStore.getState().current;
  if (!openedProject || !samePath(openedProject.path, projectPath)) return false;
  await useEditorStore.getState().openFile(path);
  const normalizedPath = path.replace(/\\/g, "/");
  return useEditorStore
    .getState()
    .tabs.some((tab) => tab.path.replace(/\\/g, "/") === normalizedPath);
}

/** Open a project requested by a dialog, the CLI, or an OS shell action. */
export async function openProjectPath(path: string, unsavedPrompt: string) {
  const current = useProjectStore.getState().current;
  if (current && samePath(current.path, path)) return true;
  if (hasDirtyEditors() && !window.confirm(unsavedPrompt)) return false;
  if (current) await stopProjectAgents(current.path);
  await useProjectStore.getState().openProject(path);
  const openedProject = useProjectStore.getState().current;
  return Boolean(openedProject && samePath(openedProject.path, path));
}

export async function closeCurrentProject(unsavedPrompt: string) {
  const current = useProjectStore.getState().current;
  if (!current) return;
  if (hasDirtyEditors() && !window.confirm(unsavedPrompt)) return;
  await stopProjectAgents(current.path);
  await useProjectStore.getState().closeProject();
  useTerminalStore.getState().setOpen(false);
  useUiStore.getState().setAgentOpen(false);
  useUiStore.getState().closeSettings();
}
