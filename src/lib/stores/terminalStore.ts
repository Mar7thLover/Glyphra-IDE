import { create } from "zustand";

interface TerminalState {
  open: boolean;
  height: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setHeight: (height: number) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  open: false,
  height: 220,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
  setHeight: (height) => set({ height: Math.max(120, Math.min(480, height)) }),
}));
