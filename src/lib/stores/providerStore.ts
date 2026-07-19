import { create } from "zustand";

import { ipc, type ProviderKind, type ProviderRecord } from "@/lib/ipc/ipc";

export const OPENROUTER_PRESET = {
  name: "OpenRouter",
  kind: "custom-openai" as ProviderKind,
  baseUrl: "https://openrouter.ai/api/v1",
  model: "openai/gpt-4.1-mini",
};

interface ProviderState {
  providers: ProviderRecord[];
  loading: boolean;
  testingId: string | null;
  /** Per-provider last test message. */
  testResults: Record<string, { ok: boolean; detail: string }>;
  error: string | null;
  refresh: () => Promise<void>;
  upsert: (input: {
    id?: string | null;
    kind: ProviderKind;
    name: string;
    baseUrl?: string | null;
    model?: string | null;
    secret?: string | null;
  }) => Promise<ProviderRecord | null>;
  remove: (id: string) => Promise<void>;
  test: (id: string) => Promise<void>;
  /** Prepare OpenRouter form values — does not save without a key. */
  openRouterPreset: () => {
    kind: ProviderKind;
    name: string;
    baseUrl: string;
    model: string;
  };
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  testingId: null,
  testResults: {},
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      set({ providers: await ipc.providersList(), loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  upsert: async (input) => {
    set({ error: null });
    try {
      const record = await ipc.providersUpsert({
        id: input.id ?? null,
        kind: input.kind,
        name: input.name,
        baseUrl: input.baseUrl ?? null,
        model: input.model ?? null,
        secret: input.secret ?? null,
      });
      await get().refresh();
      return record;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  remove: async (id) => {
    set({ error: null });
    try {
      await ipc.providersRemove(id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  test: async (id) => {
    set({ testingId: id, error: null });
    try {
      const result = await ipc.providerTest(id);
      const detail =
        result.status > 0
          ? `${result.ok ? "OK" : "Failed"} · HTTP ${result.status}: ${result.detail}`
          : result.detail;
      set((state) => ({
        testingId: null,
        testResults: {
          ...state.testResults,
          [id]: { ok: result.ok, detail },
        },
      }));
    } catch (error) {
      set({
        testingId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  openRouterPreset: () => ({
    kind: OPENROUTER_PRESET.kind,
    name: OPENROUTER_PRESET.name,
    baseUrl: OPENROUTER_PRESET.baseUrl,
    model: OPENROUTER_PRESET.model,
  }),
}));
