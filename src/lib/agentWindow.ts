import { ipc } from "@/lib/ipc/ipc";
import { useProjectStore } from "@/lib/stores/projectStore";

/** localStorage handoff: which project the standalone Agents window should preselect. */
export const AGENT_WINDOW_PROJECT_KEY = "glyphra.agentWindow.project";

/** Open (or focus) the standalone Agents window, handing off the active project. */
export async function openAgentsWindow(): Promise<void> {
  const current = useProjectStore.getState().current;
  if (current) {
    localStorage.setItem(AGENT_WINDOW_PROJECT_KEY, current.path);
  }
  await ipc.windowOpenAgent();
}
