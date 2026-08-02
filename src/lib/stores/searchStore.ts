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

/** Identifies the current run locally. The backend `searchId` only arrives
 *  after `searchStart` resolves, so batches from a superseded search cannot be
 *  told apart by id alone — and a search whose id lands late would otherwise
 *  never be cancelled, leaving its walk running. */
let runToken = 0;

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
    runToken += 1;
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
      await get().cancel();
      set({ hits: [], searching: false });
      return;
    }
    await get().cancel();
    const token = runToken;
    set({ query: trimmed, hits: [], searching: true, error: null });
    try {
      const searchId = await ipc.searchStart(
        roots,
        trimmed,
        get().options,
        (batch) => {
          if (token !== runToken) return;
          set((state) => ({
            hits: batch.done ? state.hits : [...state.hits, ...batch.hits],
            searching: !batch.done,
          }));
        },
      );
      // A newer run started while this one was being registered: its id is only
      // known now, so cancel it here or the walk runs to completion unnoticed.
      if (token !== runToken) {
        void ipc.searchCancel(searchId).catch(() => undefined);
        return;
      }
      set({ searchId });
    } catch (error) {
      if (token !== runToken) return;
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
    runToken += 1;
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
    runToken += 1;
    const searchId = get().searchId;
    if (searchId != null) void ipc.searchCancel(searchId).catch(() => undefined);
    set({ hits: [], query: "", searching: false, searchId: null, error: null });
  },
}));
