import { create } from "zustand";

import { agentBus, type AgentSessionHandle } from "@/lib/acp/bus";
import type {
  AgentPermissionMode,
  AgentStartOptions,
  AgentTimelineItem,
  PermissionPrompt,
  StartableBackend,
} from "@/lib/acp/types";
import { ipc, type AgentDetectInfo } from "@/lib/ipc/ipc";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";

interface AgentState {
  backends: AgentDetectInfo[];
  detecting: boolean;
  session: AgentSessionHandle | null;
  items: AgentTimelineItem[];
  permission: PermissionPrompt | null;
  busy: boolean;
  error: string | null;
  mode: AgentPermissionMode;
  providerId: string | null;
  detect: () => Promise<void>;
  setMode: (mode: AgentPermissionMode) => void;
  setProviderId: (id: string | null) => void;
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

export const useAgentStore = create<AgentState>((set, get) => ({
  backends: [],
  detecting: false,
  session: null,
  items: [],
  permission: null,
  busy: false,
  error: null,
  mode: "standard",
  providerId: null,

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

  setMode: (mode) => set({ mode }),
  setProviderId: (providerId) => set({ providerId }),

  start: async (backend, cwd) => {
    ensureBusSubscription(set);
    set({ busy: true, error: null });
    try {
      const options: AgentStartOptions = {
        mode: get().mode,
        providerId: get().providerId,
      };
      const session = await agentBus.start(backend, cwd, options);
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
    const projectPath = useProjectStore.getState().current?.path ?? null;
    let turnId: string | null = null;
    if (projectPath) {
      try {
        const turn = await ipc.ckptBeginTurn(projectPath, trimmed.slice(0, 48));
        turnId = turn.id;
      } catch {
        // Checkpoints are best-effort — continue the prompt without them.
      }
    }
    try {
      await agentBus.prompt(trimmed);
      set({ busy: false });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (projectPath) {
        try {
          const meta = await ipc.ckptCommitTurn(projectPath, turnId);
          useReviewStore.getState().ingestTurn(meta);
        } catch {
          // ignore commit failures
        }
      }
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
