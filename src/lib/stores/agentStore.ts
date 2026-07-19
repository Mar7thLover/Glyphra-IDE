import { create } from "zustand";

import { agentBus, type AgentBusMessage, type AgentSessionHandle } from "@/lib/acp/bus";
import { ipc, type AgentDetectInfo } from "@/lib/ipc/ipc";
import type { AgentBackendKind } from "@/lib/acp/types";

interface AgentState {
  backends: AgentDetectInfo[];
  detecting: boolean;
  session: AgentSessionHandle | null;
  messages: AgentBusMessage[];
  busy: boolean;
  error: string | null;
  detect: () => Promise<void>;
  start: (backend: AgentBackendKind | "fixture", cwd: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  stop: () => Promise<void>;
}

let subscribed = false;

function ensureBusSubscription(set: (partial: Partial<AgentState>) => void) {
  if (subscribed) return;
  subscribed = true;
  agentBus.subscribe((session) => {
    set({
      session,
      messages: session.messages,
      error: session.error ?? null,
    });
  });
}

export const useAgentStore = create<AgentState>((set, get) => ({
  backends: [],
  detecting: false,
  session: null,
  messages: [],
  busy: false,
  error: null,

  detect: async () => {
    set({ detecting: true, error: null });
    try {
      const backends = await ipc.agentDetect();
      set({ backends, detecting: false });
    } catch (error) {
      set({
        detecting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  start: async (backend, cwd) => {
    ensureBusSubscription(set);
    set({ busy: true, error: null });
    try {
      const session = await agentBus.start(backend, cwd);
      set({ session, messages: session.messages, busy: false });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  prompt: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set({ busy: true, error: null });
    try {
      await agentBus.prompt(trimmed);
      set({ busy: false, messages: get().session?.messages ?? get().messages });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  stop: async () => {
    set({ busy: true });
    try {
      await agentBus.stop();
      set({ busy: false, session: null });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
