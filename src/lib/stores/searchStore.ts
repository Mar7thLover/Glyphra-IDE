import { create } from "zustand";

import { ipc, type SearchHit } from "@/lib/ipc/ipc";

interface SearchState {
  query: string;
  hits: SearchHit[];
  searching: boolean;
  searchId: number | null;
  error: string | null;
  setQuery: (query: string) => void;
  run: (root: string, query: string) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  hits: [],
  searching: false,
  searchId: null,
  error: null,

  setQuery: (query) => set({ query }),

  run: async (root, query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ hits: [], searching: false });
      return;
    }
    await get().cancel();
    set({ query: trimmed, hits: [], searching: true, error: null });
    try {
      const searchId = await ipc.searchStart(root, trimmed, (batch) => {
        set((state) => {
          if (state.searchId !== null && batch.searchId !== state.searchId) return state;
          return {
            searchId: state.searchId ?? batch.searchId,
            hits: batch.done ? state.hits : [...state.hits, ...batch.hits],
            searching: !batch.done,
          };
        });
      });
      set((state) => ({ searchId: state.searchId ?? searchId }));
    } catch (error) {
      set({
        searching: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  cancel: async () => {
    const id = get().searchId;
    if (id != null) {
      try {
        await ipc.searchCancel(id);
      } catch {
        // ignore
      }
    }
    set({ searchId: null, searching: false });
  },

  clear: () => set({ hits: [], query: "", searching: false, searchId: null }),
}));
