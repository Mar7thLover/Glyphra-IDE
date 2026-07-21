import { open as openDialog } from "@tauri-apps/plugin-dialog";

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
  const current = useProjectStore.getState().current;
  if (current?.path === path) return;
  if (hasDirtyEditors() && !window.confirm(unsavedPrompt)) return;
  await stopActiveAgent();
  await useProjectStore.getState().openProject(path);
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
