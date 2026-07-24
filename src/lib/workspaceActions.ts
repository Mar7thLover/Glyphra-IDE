import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { dirname } from "@tauri-apps/api/path";

import { useAgentStore } from "@/lib/stores/agentStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

function hasDirtyEditors() {
  return useEditorStore.getState().tabs.some((tab) => tab.content !== tab.savedContent);
}

async function stopActiveAgent() {
  if (useAgentStore.getState().session) {
    await useAgentStore.getState().stop().catch(() => undefined);
  }
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
  const opened = await openProjectPath(projectPath, unsavedPrompt);
  if (!opened) return false;
  await useEditorStore.getState().openFile(path);
  const normalizedPath = path.replace(/\\/g, "/");
  return useEditorStore
    .getState()
    .tabs.some((tab) => tab.path.replace(/\\/g, "/") === normalizedPath);
}

/** Open a project requested by a dialog, the CLI, or an OS shell action. */
export async function openProjectPath(path: string, unsavedPrompt: string) {
  const current = useProjectStore.getState().current;
  if (current?.path === path) return true;
  if (hasDirtyEditors() && !window.confirm(unsavedPrompt)) return false;
  await stopActiveAgent();
  await useProjectStore.getState().openProject(path);
  return useProjectStore.getState().current?.path === path;
}

export async function closeCurrentProject(unsavedPrompt: string) {
  if (!useProjectStore.getState().current) return;
  if (hasDirtyEditors() && !window.confirm(unsavedPrompt)) return;
  await stopActiveAgent();
  await useProjectStore.getState().closeProject();
  useTerminalStore.getState().setOpen(false);
  useUiStore.getState().setAgentOpen(false);
  useUiStore.getState().closeSettings();
}
