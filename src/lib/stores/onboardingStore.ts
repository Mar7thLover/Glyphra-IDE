import { create } from "zustand";

import { ipc, type AgentDetectInfo, type RuntimeDetectInfo } from "@/lib/ipc/ipc";

const STORAGE_KEY = "glyphra.onboarding.done";

interface OnboardingState {
  open: boolean;
  loading: boolean;
  error: string | null;
  runtime: RuntimeDetectInfo | null;
  agents: AgentDetectInfo[];
  openOnboarding: () => void;
  closeOnboarding: (markDone?: boolean) => void;
  refresh: () => Promise<void>;
  /** Call once at boot: open if never completed. */
  maybeAutoOpen: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  open: false,
  loading: false,
  error: null,
  runtime: null,
  agents: [],

  openOnboarding: () => {
    set({ open: true });
    void get().refresh();
  },

  closeOnboarding: (markDone = false) => {
    if (markDone) localStorage.setItem(STORAGE_KEY, "1");
    set({ open: false });
  },

  maybeAutoOpen: () => {
    if (localStorage.getItem(STORAGE_KEY) === "1") return;
    get().openOnboarding();
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [runtime, agents] = await Promise.all([ipc.runtimeDetect(), ipc.agentDetect()]);
      set({ runtime, agents, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
