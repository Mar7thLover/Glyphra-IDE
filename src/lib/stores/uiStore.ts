import { create } from "zustand";

export type Theme = "light" | "dark";
/** Left sidebar panels only — Agent lives on the right. */
export type Panel = "files" | "search" | "settings";

const AGENT_OPEN_KEY = "glyphra.agentOpen";

function readAgentOpen(): boolean {
  const stored = localStorage.getItem(AGENT_OPEN_KEY);
  // Fresh installs start with Agent closed so the welcome home can breathe;
  // opening a project (or the titlebar pill) turns it on.
  if (stored === null) return false;
  return stored === "1";
}

interface UiState {
  theme: Theme;
  mica: boolean;
  activePanel: Panel;
  sidebarOpen: boolean;
  /** Right-hand Agent workspace. Default open. */
  agentOpen: boolean;
  setTheme: (theme: Theme) => void;
  setMica: (mica: boolean) => void;
  togglePanel: (panel: Panel) => void;
  setAgentOpen: (open: boolean) => void;
  toggleAgent: () => void;
  /** Open (or focus) the right Agent panel — used by the titlebar shortcut. */
  openAgent: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: (document.documentElement.dataset.theme as Theme) ?? "dark",
  mica: document.documentElement.dataset.mica === "true",
  activePanel: "files",
  sidebarOpen: true,
  agentOpen: readAgentOpen(),

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
}));
