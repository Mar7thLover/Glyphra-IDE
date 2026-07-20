import { create } from "zustand";

import {
  deleteArchive,
  listArchives,
  loadArchive,
  persistSession,
  type SessionSummary,
} from "@/lib/acp/archive";
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
  circuitOpen: boolean;
  archives: SessionSummary[];
  /** When set, timeline is a read-only past archive (no live ACP session). */
  viewingArchiveId: string | null;
  detect: () => Promise<void>;
  setMode: (mode: AgentPermissionMode) => void;
  setProviderId: (id: string | null) => void;
  setBackend: (backend: StartableBackend) => void;
  clearError: () => void;
  clearCircuit: () => void;
  start: (cwd?: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | "cancelled") => void;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  refreshArchives: (projectPath: string) => Promise<void>;
  openArchive: (projectPath: string, id: string) => Promise<void>;
  clearArchiveView: () => void;
  removeArchive: (projectPath: string, id: string) => Promise<void>;
}

let subscribed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(session: AgentSessionHandle | null) {
  if (!session || session.items.length === 0) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistSession({
      id: session.archiveId,
      projectPath: session.projectPath,
      backend: session.backend,
      acpSessionId: session.acpSessionId,
      createdAt: session.createdAt,
      items: session.items,
    }).catch(() => {
      // Archive failures must not break the live session.
    });
  }, 400);
}

function ensureBusSubscription(set: (partial: Partial<AgentState>) => void, get: () => AgentState) {
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
      circuitOpen: session.circuitOpen,
      viewingArchiveId: null,
    });
    schedulePersist(session);
    if (session.status === "exited" || session.status === "crashed") {
      void get()
        .refreshArchives(session.projectPath)
        .catch(() => undefined);
    }
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
  circuitOpen: false,
  archives: [],
  viewingArchiveId: null,

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

  clearCircuit: () => {
    agentBus.clearCircuit();
    set({ circuitOpen: false, error: null });
  },

  start: async (cwd) => {
    ensureBusSubscription(set, get);
    if (agentBus.isCircuitOpen()) {
      set({
        circuitOpen: true,
        error:
          "Circuit open: too many crashes. Reset the breaker, then start again.",
      });
      return;
    }
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
    set({ busy: true, error: null, stderrTail: [], viewingArchiveId: null });
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
      await get().refreshArchives(projectPath);
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
        // Checkpoints are best-effort — continue the prompt without them.
      }
    }
    try {
      await agentBus.prompt(trimmed);
      set({ busy: false });
      const session = agentBus.getSession();
      if (session) {
        await persistSession({
          id: session.archiveId,
          projectPath: session.projectPath,
          backend: session.backend,
          acpSessionId: session.acpSessionId,
          createdAt: session.createdAt,
          items: session.items,
        });
        await get().refreshArchives(session.projectPath);
      }
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

  cancel: async () => {
    await agentBus.cancel();
  },

  respondPermission: (optionId) => {
    agentBus.respondPermission(optionId);
  },

  stop: async () => {
    set({ busy: true });
    const live = agentBus.getSession();
    try {
      if (live && live.items.length > 0) {
        await persistSession({
          id: live.archiveId,
          projectPath: live.projectPath,
          backend: live.backend,
          acpSessionId: live.acpSessionId,
          createdAt: live.createdAt,
          items: live.items,
        });
      }
      await agentBus.stop();
      set({
        busy: false,
        session: null,
        permission: null,
        items: get().items,
      });
      if (live) await get().refreshArchives(live.projectPath);
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  restart: async () => {
    if (agentBus.isCircuitOpen() || get().circuitOpen) {
      set({
        circuitOpen: true,
        error:
          "Circuit open: too many crashes. Reset the breaker, then restart.",
      });
      return;
    }
    await get().stop();
    await get().start();
  },

  refreshArchives: async (projectPath) => {
    if (!projectPath) {
      set({ archives: [] });
      return;
    }
    try {
      const archives = await listArchives(projectPath);
      set({ archives });
    } catch {
      // Browser / missing IPC — keep prior list.
    }
  },

  openArchive: async (projectPath, id) => {
    try {
      if (agentBus.getSession()) {
        await get().stop();
      }
      const { items } = await loadArchive(projectPath, id);
      set({
        viewingArchiveId: id,
        session: null,
        permission: null,
        items,
        busy: false,
        error: null,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  clearArchiveView: () => {
    set({ viewingArchiveId: null, items: [] });
  },

  removeArchive: async (projectPath, id) => {
    await deleteArchive(projectPath, id);
    if (get().viewingArchiveId === id) {
      set({ viewingArchiveId: null, items: [] });
    }
    await get().refreshArchives(projectPath);
  },
}));
