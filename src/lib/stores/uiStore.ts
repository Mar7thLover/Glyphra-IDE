import { create } from "zustand";

export type Theme = "light" | "dark";
/** Left sidebar panels — Settings is a separate full page. */
export type Panel = "files" | "search";
export type WorkspaceView = "editor" | "git-review";
export type SettingsSection =
  | "personal"
  | "models"
  | "editor"
  | "keybindings"
  | "agent"
  | "mcp"
  | "about";

const AGENT_OPEN_KEY = "glyphra.agentOpen";

function readAgentOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
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
  theme:
    typeof document === "undefined"
      ? "dark"
      : ((document.documentElement.dataset.theme as Theme) ?? "dark"),
  mica:
    typeof document !== "undefined" &&
    document.documentElement.dataset.mica === "true",
  hostOs: "",
  activePanel: "files",
  workspaceView: "editor",
  sidebarOpen: true,
  agentOpen: readAgentOpen(),
  settingsOpen: false,
  settingsSection: "personal",

  setTheme: (theme) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("glyphra.theme", theme);
    }
    set({ theme });
  },

  setMica: (mica) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.mica = String(mica);
    }
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

  setHostOs: (hostOs) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.platform = hostOs;
    }
    set({ hostOs });
  },

  showPanel: (panel) =>
    set({ activePanel: panel, sidebarOpen: true, settingsOpen: false, workspaceView: "editor" }),

  showWorkspace: (workspaceView) => set({ workspaceView, settingsOpen: false }),

  setAgentOpen: (open) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AGENT_OPEN_KEY, open ? "1" : "0");
    }
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
