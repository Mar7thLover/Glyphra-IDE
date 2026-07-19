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
  archives: SessionSummary[];
  /** When set, timeline is a read-only past archive (no live ACP session). */
  viewingArchiveId: string | null;
  detect: () => Promise<void>;
  setMode: (mode: AgentPermissionMode) => void;
  setProviderId: (id: string | null) => void;
  start: (backend: StartableBackend, cwd: string) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | "cancelled") => void;
  stop: () => Promise<void>;
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
  archives: [],
  viewingArchiveId: null,

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
    ensureBusSubscription(set, get);
    set({ busy: true, error: null, viewingArchiveId: null });
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
      await get().refreshArchives(cwd);
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
      set({ busy: false, session: null, permission: null });
      if (live) await get().refreshArchives(live.projectPath);
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
