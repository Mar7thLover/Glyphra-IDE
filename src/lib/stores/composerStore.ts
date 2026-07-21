import { create } from "zustand";

import type { ComposerReference } from "@/lib/composerContext";

export const COMPOSER_FOCUS_EVENT = "glyphra:composer-focus";

interface ComposerState {
  draft: string;
  references: ComposerReference[];
  setDraft: (draft: string) => void;
  setReferences: (references: ComposerReference[]) => void;
  addReference: (reference: Omit<ComposerReference, "id">) => void;
  removeReference: (id: string) => void;
  reset: () => void;
}

export const useComposerDraft = create<ComposerState>((set) => ({
  draft: "",
  references: [],
  setDraft: (draft) => set({ draft }),
  setReferences: (references) => set({ references }),
  addReference: (reference) =>
    set((state) => {
      const duplicate = state.references.find(
        (item) =>
          item.kind === reference.kind &&
          item.path === reference.path &&
          item.content === reference.content,
      );
      if (duplicate) return state;
      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      return { references: [...state.references, { ...reference, id }] };
    }),
  removeReference: (id) =>
    set((state) => ({ references: state.references.filter((reference) => reference.id !== id) })),
  reset: () => set({ draft: "", references: [] }),
}));

export function focusAgentComposer() {
  window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
}
