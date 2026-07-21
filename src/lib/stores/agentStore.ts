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
  AgentApprovalReviewer,
  AgentStartOptions,
  AgentSessionRestore,
  AgentTimelineItem,
  PermissionPrompt,
  StartableBackend,
  CustomAgentProtocol,
} from "@/lib/acp/types";
import {
  ipc,
  type AgentDetectInfo,
  type AgentHarnessCatalog,
} from "@/lib/ipc/ipc";
import { useHarnessStore } from "@/lib/stores/harnessStore";
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
  model: string | null;
  reasoningEffort: string | null;
  contextWindow: number | null;
  fastMode: boolean;
  approvalReviewer: AgentApprovalReviewer;
  catalog: AgentHarnessCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  backend: StartableBackend;
  stderrTail: string[];
  circuitOpen: boolean;
  archives: SessionSummary[];
  /** Recovery fallback: saved timeline is visible, but no agent process is attached yet. */
  viewingArchiveId: string | null;
  detect: () => Promise<void>;
  setMode: (mode: AgentPermissionMode) => void;
  setProviderId: (id: string | null) => void;
  setModel: (model: string | null) => void;
  setReasoningEffort: (effort: string | null) => void;
  setContextWindow: (tokens: number | null) => void;
  setFastMode: (enabled: boolean) => void;
  setApprovalReviewer: (reviewer: AgentApprovalReviewer) => void;
  configureSession: () => Promise<void>;
  refreshCatalog: (cwd?: string) => Promise<void>;
  setBackend: (backend: StartableBackend) => void;
  clearError: () => void;
  clearCircuit: () => void;
  start: (cwd?: string, restore?: AgentSessionRestore) => Promise<void>;
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | "cancelled") => void;
  stop: () => Promise<void>;
  newConversation: () => Promise<void>;
  restart: () => Promise<void>;
  refreshArchives: (projectPath: string) => Promise<void>;
  openArchive: (projectPath: string, id: string) => Promise<void>;
  clearArchiveView: () => void;
  removeArchive: (projectPath: string, id: string) => Promise<void>;
}

let subscribed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let catalogRequestId = 0;

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
  if (preferred.startsWith("custom:") && useHarnessStore.getState().harnesses.some((item) => `custom:${item.id}` === preferred)) {
    return preferred;
  }
  const preferredInfo = backends.find((b) => b.backend === preferred);
  if (preferredInfo?.installed) return preferred;
  const order: StartableBackend[] = ["codex-acp", "claude-acp", "opencode-acp", "pi-agent", "fixture"];
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
  model: usePrefsStore.getState().defaultAgentModel,
  reasoningEffort: usePrefsStore.getState().defaultReasoningEffort,
  contextWindow: usePrefsStore.getState().defaultContextWindow,
  fastMode: usePrefsStore.getState().defaultFastMode,
  approvalReviewer: usePrefsStore.getState().defaultApprovalReviewer,
  catalog: null,
  catalogLoading: false,
  catalogError: null,
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
      const stillOk = current.startsWith("custom:")
        ? useHarnessStore.getState().harnesses.some((item) => `custom:${item.id}` === current)
        : backends.some((b) => b.backend === current && b.installed);
      const backend = stillOk ? current : pickReadyBackend(backends, current);
      set({ backends, detecting: false, backend, error: null });
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
    const changed = get().providerId !== providerId;
    set(changed ? { providerId, catalog: null, catalogError: null } : { providerId });
    usePrefsStore.getState().setPref("defaultProviderId", providerId);
  },

  setModel: (model) => {
    const catalogModel = get().catalog?.models.find((entry) => entry.id === model);
    const effort = catalogModel?.defaultReasoningEffort ?? get().reasoningEffort;
    const fastMode = catalogModel?.supportsFastMode ? get().fastMode : false;
    set({ model, reasoningEffort: effort, fastMode });
    usePrefsStore.getState().setPref("defaultAgentModel", model);
    usePrefsStore.getState().setPref("defaultReasoningEffort", effort);
    usePrefsStore.getState().setPref("defaultFastMode", fastMode);
  },

  setReasoningEffort: (reasoningEffort) => {
    set({ reasoningEffort });
    usePrefsStore.getState().setPref("defaultReasoningEffort", reasoningEffort);
  },

  setContextWindow: (contextWindow) => {
    set({ contextWindow });
    usePrefsStore.getState().setPref("defaultContextWindow", contextWindow);
  },

  setFastMode: (fastMode) => {
    set({ fastMode });
    usePrefsStore.getState().setPref("defaultFastMode", fastMode);
  },

  setApprovalReviewer: (approvalReviewer) => {
    set({ approvalReviewer });
    usePrefsStore.getState().setPref("defaultApprovalReviewer", approvalReviewer);
  },

  configureSession: async () => {
    try {
      await agentBus.configure({
        model: get().model,
        reasoningEffort: get().reasoningEffort,
        fastMode: get().fastMode,
        mode: get().mode,
      });
      set({ error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  refreshCatalog: async (cwd) => {
    const requestId = ++catalogRequestId;
    const projectPath = cwd ?? useProjectStore.getState().current?.path;
    const info = get().backends.find((entry) => entry.backend === get().backend);
    if (!projectPath || !info?.installed || !info.command || info.protocol === "acp") {
      set({ catalog: null, catalogLoading: false, catalogError: null });
      return;
    }
    set({ catalogLoading: true, catalogError: null });
    try {
      const catalog = await ipc.agentCatalog({
        protocol: info.protocol,
        command: info.command,
        args: info.args,
        cwd: projectPath,
        providerId: get().providerId,
        model: get().model,
        reasoningEffort: get().reasoningEffort,
        contextWindow: get().contextWindow,
        fastMode: get().fastMode,
        mode: get().mode,
      });
      if (requestId !== catalogRequestId) return;
      const selected = catalog.models.find((entry) => entry.id === get().model);
      const defaultModel = catalog.models.find((entry) => entry.id === catalog.defaultModel);
      const model = selected?.id ?? defaultModel?.id ?? catalog.models[0]?.id ?? null;
      const modelInfo = catalog.models.find((entry) => entry.id === model);
      const validEffort = modelInfo?.reasoningEfforts.some(
        (entry) => entry.id === get().reasoningEffort,
      );
      const reasoningEffort = validEffort
        ? get().reasoningEffort
        : (modelInfo?.defaultReasoningEffort ?? modelInfo?.reasoningEfforts[0]?.id ?? null);
      const fastMode = modelInfo?.supportsFastMode ? get().fastMode : false;
      set({ catalog, model, reasoningEffort, fastMode, catalogLoading: false });
    } catch (error) {
      if (requestId !== catalogRequestId) return;
      set({
        catalog: null,
        catalogLoading: false,
        catalogError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setBackend: (backend) => {
    const changed = get().backend !== backend;
    set(changed ? { backend, catalog: null, catalogError: null } : { backend });
    usePrefsStore.getState().setPref("defaultBackend", backend);
  },

  clearError: () => set({ error: null }),

  clearCircuit: () => {
    agentBus.clearCircuit();
    set({ circuitOpen: false, error: null });
  },

  start: async (cwd, restore) => {
    ensureBusSubscription(set, get);
    if (get().backend === "auto" || get().backends.length === 0) {
      await get().detect();
    }
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
    const selectedBackend = get().backend;
    const custom = selectedBackend.startsWith("custom:")
      ? useHarnessStore.getState().harnesses.find((item) => `custom:${item.id}` === selectedBackend)
      : null;
    const info = get().backends.find((b) => b.backend === selectedBackend);
    if ((!custom && !info) || (info && !info.installed && selectedBackend !== "fixture")) {
      set({
        error: info
          ? `${selectedBackend} is not installed. ${info.detail}`
          : `Harness configuration for ${selectedBackend} was not found.`,
      });
      return;
    }
    if (get().mode === "unleashed") {
      const ok = window.confirm(
        "Full access skips approvals and sandbox restrictions for this session. Continue?",
      );
      if (!ok) return;
    }
    set({ busy: true, error: null, stderrTail: [], viewingArchiveId: null });
    try {
      const options: AgentStartOptions = {
        mode: get().mode,
        providerId: get().providerId,
        model: get().model,
        reasoningEffort: get().reasoningEffort,
        contextWindow: get().contextWindow,
        fastMode: get().fastMode,
        approvalReviewer: get().approvalReviewer,
        prewarmedSessionId: get().catalog?.prewarmedSessionId ?? null,
        restore,
        harness: custom
          ? {
              protocol: custom.protocol,
              command: custom.command || null,
              args: custom.args,
              env: custom.env,
              endpoint: custom.endpoint ?? null,
              model: custom.model ?? null,
            }
          : info && info.backend !== "fixture"
            ? {
                protocol: info.protocol as CustomAgentProtocol,
                command: info.command,
                args: info.args,
              }
            : undefined,
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

  newConversation: async () => {
    if (agentBus.getSession() || get().session) {
      await get().stop();
    }
    set({
      session: null,
      items: [],
      permission: null,
      busy: false,
      error: null,
      viewingArchiveId: null,
      stderrTail: [],
    });
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
      if (get().session?.archiveId === id && get().session?.status === "running") return;
      if (agentBus.getSession()) {
        await get().stop();
      }
      const { meta, items } = await loadArchive(projectPath, id);
      const archivedBackend = meta.backend as StartableBackend;
      set({
        backend: archivedBackend,
        viewingArchiveId: id,
        session: null,
        permission: null,
        items,
        busy: true,
        error: null,
      });
      await get().start(projectPath, {
        archiveId: meta.id,
        acpSessionId: meta.acpSessionId,
        createdAt: meta.createdAt,
        items,
      });
      const restored = get().session;
      if (restored?.archiveId !== id || restored.status !== "running") {
        set({
          viewingArchiveId: id,
          session: null,
          permission: null,
          items,
          busy: false,
        });
      }
    } catch (error) {
      set({
        viewingArchiveId: id,
        session: null,
        busy: false,
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
