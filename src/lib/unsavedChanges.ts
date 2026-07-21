import { create } from "zustand";

export type UnsavedDecision = "save" | "discard" | "cancel";

interface PendingDecision {
  name: string;
  resolve: (decision: UnsavedDecision) => void;
}

interface UnsavedChangesState {
  pending: PendingDecision | null;
  request: (name: string) => Promise<UnsavedDecision>;
  decide: (decision: UnsavedDecision) => void;
}

export const useUnsavedChangesStore = create<UnsavedChangesState>((set, get) => ({
  pending: null,
  request: (name) =>
    new Promise<UnsavedDecision>((resolve) => {
      // Resolve a superseded request conservatively so callers never hang.
      get().pending?.resolve("cancel");
      set({ pending: { name, resolve } });
    }),
  decide: (decision) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(decision);
  },
}));

export function requestUnsavedDecision(name: string) {
  return useUnsavedChangesStore.getState().request(name);
}
