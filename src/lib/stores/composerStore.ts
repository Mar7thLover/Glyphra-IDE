import { create } from "zustand";

import type { ComposerReference } from "@/lib/composerContext";
import type { AgentImageAttachment } from "@/lib/acp/types";

export const COMPOSER_FOCUS_EVENT = "glyphra:composer-focus";

interface ComposerState {
  draft: string;
  references: ComposerReference[];
  images: AgentImageAttachment[];
  /** Secondary composer pills stay folded until the user opens them. */
  optionsExpanded: boolean;
  toggleOptions: () => void;
  setDraft: (draft: string) => void;
  setReferences: (references: ComposerReference[]) => void;
  setImages: (images: AgentImageAttachment[]) => void;
  addReference: (reference: Omit<ComposerReference, "id">) => void;
  removeReference: (id: string) => void;
  removeImage: (id: string) => void;
  reset: () => void;
}

export const useComposerDraft = create<ComposerState>((set) => ({
  draft: "",
  references: [],
  images: [],
  optionsExpanded: false,
  toggleOptions: () => set((state) => ({ optionsExpanded: !state.optionsExpanded })),
  setDraft: (draft) => set({ draft }),
  setReferences: (references) => set({ references }),
  setImages: (images) => set({ images }),
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
  removeImage: (id) =>
    set((state) => ({ images: state.images.filter((image) => image.id !== id) })),
  reset: () => set({ draft: "", references: [], images: [] }),
}));

export function focusAgentComposer() {
  window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
}
