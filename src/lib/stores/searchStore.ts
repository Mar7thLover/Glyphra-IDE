import { create } from "zustand";

import { ipc, type SearchHit, type SearchOptions } from "@/lib/ipc/ipc";

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: [],
  exclude: [],
};

interface SearchState {
  query: string;
  options: SearchOptions;
  hits: SearchHit[];
  searching: boolean;
  searchId: number | null;
  error: string | null;
  setQuery: (query: string) => void;
  setOptions: (options: Partial<SearchOptions>) => void;
  run: (roots: string[], query: string) => Promise<void>;
  replaceAll: (roots: string[], replacement: string) => Promise<boolean>;
  cancel: () => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  options: { ...DEFAULT_SEARCH_OPTIONS },
  hits: [],
  searching: false,
  searchId: null,
  error: null,

  setQuery: (query) => {
    if (query) {
      set({ query });
      return;
    }
    const searchId = get().searchId;
    if (searchId != null) void ipc.searchCancel(searchId).catch(() => undefined);
    set({ query: "", hits: [], searching: false, searchId: null, error: null });
  },

  setOptions: (options) => {
    const next = { ...get().options, ...options };
    set({ options: next });
  },

  run: async (roots, query) => {
    const trimmed = query.trim();
    if (!trimmed || roots.length === 0) {
      set({ hits: [], searching: false });
      return;
    }
    await get().cancel();
    set({ query: trimmed, hits: [], searching: true, error: null });
    try {
      const searchId = await ipc.searchStart(
        roots,
        trimmed,
        get().options,
        (batch) => {
          set((state) => {
            if (state.searchId !== null && batch.searchId !== state.searchId) return state;
            return {
              searchId: state.searchId ?? batch.searchId,
              hits: batch.done ? state.hits : [...state.hits, ...batch.hits],
              searching: !batch.done,
            };
          });
        },
      );
      set((state) => ({ searchId: state.searchId ?? searchId }));
    } catch (error) {
      set({
        searching: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  replaceAll: async (roots, replacement) => {
    const trimmed = get().query.trim();
    if (!trimmed || roots.length === 0) return false;
    try {
      const summary = await ipc.searchReplace(roots, trimmed, replacement, get().options);
      if (summary.filesChanged > 0) {
        // Rewrite the result set: re-run the search so hits reflect the
        // post-replacement content.
        await get().run(roots, trimmed);
      }
      return summary.filesChanged > 0 || summary.replacements > 0;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
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

  clear: () => {
    const searchId = get().searchId;
    if (searchId != null) void ipc.searchCancel(searchId).catch(() => undefined);
    set({ hits: [], query: "", searching: false, searchId: null, error: null });
  },
}));
