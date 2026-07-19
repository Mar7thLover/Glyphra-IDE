import { create } from "zustand";

export type Theme = "light" | "dark";
/** Left sidebar panels — Settings is a separate full page. */
export type Panel = "files" | "search";

const AGENT_OPEN_KEY = "glyphra.agentOpen";

function readAgentOpen(): boolean {
  const stored = localStorage.getItem(AGENT_OPEN_KEY);
  if (stored === null) return false;
  return stored === "1";
}

interface UiState {
  theme: Theme;
  mica: boolean;
  activePanel: Panel;
  sidebarOpen: boolean;
  agentOpen: boolean;
  /** Dedicated settings page (not a sidebar panel). */
  settingsOpen: boolean;
  setTheme: (theme: Theme) => void;
  setMica: (mica: boolean) => void;
  togglePanel: (panel: Panel) => void;
  setAgentOpen: (open: boolean) => void;
  toggleAgent: () => void;
  openAgent: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: (document.documentElement.dataset.theme as Theme) ?? "dark",
  mica: document.documentElement.dataset.mica === "true",
  activePanel: "files",
  sidebarOpen: true,
  agentOpen: readAgentOpen(),
  settingsOpen: false,

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
      set({ sidebarOpen: !sidebarOpen });
    } else {
      set({ activePanel: panel, sidebarOpen: true });
    }
  },

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

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleSettings: () => set({ settingsOpen: !get().settingsOpen }),
}));
