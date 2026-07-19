import { create } from "zustand";

import { agentBus, type AgentSessionHandle } from "@/lib/acp/bus";
import type { AgentTimelineItem, PermissionPrompt, StartableBackend } from "@/lib/acp/types";
import { ipc, type AgentDetectInfo } from "@/lib/ipc/ipc";

interface AgentState {
  backends: AgentDetectInfo[];
  detecting: boolean;
  session: AgentSessionHandle | null;
  items: AgentTimelineItem[];
  permission: PermissionPrompt | null;
  busy: boolean;
  error: string | null;
  detect: () => Promise<void>;
  start: (backend: StartableBackend, cwd: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  respondPermission: (optionId: string | "cancelled") => void;
  stop: () => Promise<void>;
}

let subscribed = false;

function ensureBusSubscription(set: (partial: Partial<AgentState>) => void) {
  if (subscribed) return;
  subscribed = true;
  agentBus.subscribe((session) => {
    set({
      session,
      items: session.items,
      permission: session.permission,
      error: session.error ?? null,
      busy: session.status === "busy" || session.status === "starting",
    });
  });
}

export const useAgentStore = create<AgentState>((set) => ({
  backends: [],
  detecting: false,
  session: null,
  items: [],
  permission: null,
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
      set({
        session,
        items: session.items,
        permission: session.permission,
        busy: false,
      });
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
      set({ busy: false });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  respondPermission: (optionId) => {
    agentBus.respondPermission(optionId);
  },

  stop: async () => {
    set({ busy: true });
    try {
      await agentBus.stop();
      set({ busy: false, session: null, permission: null });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
