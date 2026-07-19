import { create } from "zustand";

export type Theme = "light" | "dark";
export type Panel = "files" | "search" | "agent" | "settings";

interface UiState {
  theme: Theme;
  mica: boolean;
  activePanel: Panel;
  sidebarOpen: boolean;
  setTheme: (theme: Theme) => void;
  setMica: (mica: boolean) => void;
  togglePanel: (panel: Panel) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: (document.documentElement.dataset.theme as Theme) ?? "dark",
  mica: document.documentElement.dataset.mica === "true",
  activePanel: "files",
  sidebarOpen: true,

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
}));
