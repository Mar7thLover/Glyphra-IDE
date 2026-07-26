import { create } from "zustand";

export type PaletteMode = "commands" | "files" | "symbols";

interface PaletteState {
  open: boolean;
  mode: PaletteMode;
  setOpen: (open: boolean) => void;
  setMode: (mode: PaletteMode) => void;
  toggle: () => void;
  openCommands: () => void;
  openFiles: () => void;
  openSymbols: () => void;
}

export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  mode: "commands",
  setOpen: (open) => set({ open, ...(open ? {} : { mode: "commands" as const }) }),
  setMode: (mode) => set({ mode }),
  toggle: () => {
    const next = !get().open;
    set({ open: next, mode: next ? "commands" : "commands" });
  },
  openCommands: () => set({ open: true, mode: "commands" }),
  openFiles: () => set({ open: true, mode: "files" }),
  openSymbols: () => set({ open: true, mode: "symbols" }),
}));
