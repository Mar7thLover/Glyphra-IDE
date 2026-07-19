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
import { usePrefsStore } from "@/lib/stores/prefsStore";
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
  backend: StartableBackend;
  stderrTail: string[];
  detect: () => Promise<void>;
  setMode: (mode: AgentPermissionMode) => void;
  setProviderId: (id: string | null) => void;
  setBackend: (backend: StartableBackend) => void;
  clearError: () => void;
  start: (cwd?: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | "cancelled") => void;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
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
      stderrTail: session.stderrTail,
    });
  });
}

function pickReadyBackend(backends: AgentDetectInfo[], preferred: StartableBackend): StartableBackend {
  const preferredInfo = backends.find((b) => b.backend === preferred);
  if (preferredInfo?.installed) return preferred;
  const order: StartableBackend[] = ["codex-acp", "claude-acp", "pi-agent", "fixture"];
  for (const id of order) {
    if (backends.some((b) => b.backend === id && b.installed)) return id;
  }
  return "fixture";
}

export const useAgentStore = create<AgentState>((set, get) => ({
  backends: [],
  detecting: false,
  session: null,
  items: [],
  permission: null,
  busy: false,
  error: null,
  mode: usePrefsStore.getState().defaultMode,
  providerId: usePrefsStore.getState().defaultProviderId,
  backend: usePrefsStore.getState().defaultBackend,
  stderrTail: [],

  detect: async () => {
    set({ detecting: true });
    try {
      const backends = await ipc.agentDetect();
      const current = get().backend;
      const stillOk = backends.some((b) => b.backend === current && b.installed);
      const backend = stillOk ? current : pickReadyBackend(backends, current);
      set({ backends, detecting: false, backend });
      usePrefsStore.getState().setPref("defaultBackend", backend);
    } catch (error) {
      set({
        detecting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setMode: (mode) => {
    set({ mode });
    usePrefsStore.getState().setPref("defaultMode", mode);
  },

  setProviderId: (providerId) => {
    set({ providerId });
    usePrefsStore.getState().setPref("defaultProviderId", providerId);
  },

  setBackend: (backend) => {
    set({ backend });
    usePrefsStore.getState().setPref("defaultBackend", backend);
  },

  clearError: () => set({ error: null }),

  start: async (cwd) => {
    ensureBusSubscription(set);
    const projectPath = cwd ?? useProjectStore.getState().current?.path;
    if (!projectPath) {
      set({ error: "Open a project folder before starting an agent." });
      return;
    }
    const info = get().backends.find((b) => b.backend === get().backend);
    if (info && !info.installed && get().backend !== "fixture") {
      set({
        error: `${get().backend} is not installed. ${info.detail}`,
      });
      return;
    }
    if (get().mode === "unleashed") {
      const ok = window.confirm(
        "Unleashed mode bypasses edit approvals for this session. Continue?",
      );
      if (!ok) return;
    }
    set({ busy: true, error: null, stderrTail: [] });
    try {
      const options: AgentStartOptions = {
        mode: get().mode,
        providerId: get().providerId,
      };
      const session = await agentBus.start(get().backend, projectPath, options);
      set({
        session,
        items: session.items,
        permission: session.permission,
        busy: false,
        stderrTail: session.stderrTail,
      });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
        stderrTail: agentBus.getSession()?.stderrTail ?? get().stderrTail,
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
        // best-effort
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
          // ignore
        }
      }
    }
  },

  cancel: async () => {
    await agentBus.cancel();
  },

  respondPermission: (optionId) => {
    agentBus.respondPermission(optionId);
  },

  stop: async () => {
    set({ busy: true });
    try {
      await agentBus.stop();
      set({
        busy: false,
        session: null,
        permission: null,
        items: get().items,
      });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  restart: async () => {
    await get().stop();
    await get().start();
  },
}));
