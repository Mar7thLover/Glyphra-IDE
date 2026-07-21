import { create } from "zustand";

export type Theme = "light" | "dark";
/** Left sidebar panels — Settings is a separate full page. */
export type Panel = "files" | "search";
export type WorkspaceView = "editor" | "git-review";
export type SettingsSection = "personal" | "models" | "editor" | "agent" | "about";

const AGENT_OPEN_KEY = "glyphra.agentOpen";

function readAgentOpen(): boolean {
  const stored = localStorage.getItem(AGENT_OPEN_KEY);
  if (stored === null) return false;
  return stored === "1";
}

interface UiState {
  theme: Theme;
  mica: boolean;
  hostOs: string;
  activePanel: Panel;
  workspaceView: WorkspaceView;
  sidebarOpen: boolean;
  agentOpen: boolean;
  /** Dedicated settings page (not a sidebar panel). */
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  setTheme: (theme: Theme) => void;
  setMica: (mica: boolean) => void;
  setHostOs: (os: string) => void;
  togglePanel: (panel: Panel) => void;
  showPanel: (panel: Panel) => void;
  showWorkspace: (view: WorkspaceView) => void;
  setAgentOpen: (open: boolean) => void;
  toggleAgent: () => void;
  openAgent: () => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: (document.documentElement.dataset.theme as Theme) ?? "dark",
  mica: document.documentElement.dataset.mica === "true",
  hostOs: "",
  activePanel: "files",
  workspaceView: "editor",
  sidebarOpen: true,
  agentOpen: readAgentOpen(),
  settingsOpen: false,
  settingsSection: "personal",

  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("glyphra.theme", theme);
    set({ theme });
  },

  setMica: (mica) => {
    document.documentElement.dataset.mica = String(mica);
    set({ mica });
  },

  togglePanel: (panel) => {
    const { activePanel, sidebarOpen } = get();
    if (activePanel === panel) {
      set({ sidebarOpen: !sidebarOpen, workspaceView: "editor" });
    } else {
      set({ activePanel: panel, sidebarOpen: true, workspaceView: "editor" });
    }
  },

  setHostOs: (hostOs) => set({ hostOs }),

  showPanel: (panel) =>
    set({ activePanel: panel, sidebarOpen: true, settingsOpen: false, workspaceView: "editor" }),

  showWorkspace: (workspaceView) => set({ workspaceView, settingsOpen: false }),

  setAgentOpen: (open) => {
    localStorage.setItem(AGENT_OPEN_KEY, open ? "1" : "0");
    set({ agentOpen: open });
  },

  toggleAgent: () => {
    get().setAgentOpen(!get().agentOpen);
  },

  openAgent: () => {
    get().setAgentOpen(true);
  },

  openSettings: (section = "personal") => set({ settingsOpen: true, settingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set({ settingsOpen: !get().settingsOpen }),
}));
