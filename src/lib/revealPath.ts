import { getCurrentWindow } from "@tauri-apps/api/window";

import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";

/**
 * Open a path the agent touched in the editor. From the standalone Agents
 * window the editor lives in the main window, so hand focus over to it.
 */
export async function revealInEditor(path: string, line?: number): Promise<void> {
  try {
    await useEditorStore.getState().openFile(path, line ? { line, column: 1 } : undefined);
    if (getCurrentWindow().label === "agent") await ipc.windowFocusMain();
  } catch {
    // A path the agent reported may not exist on disk (deleted, or outside the
    // project). Failing to reveal it is not worth interrupting the conversation.
  }
}
