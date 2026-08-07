import { create } from "zustand";

import {
  deleteArchive,
  listArchives,
  loadArchive,
  persistSession,
  renameArchive,
  type SessionSummary,
} from "@/lib/acp/archive";
import { AgentBus, type AgentSessionHandle } from "@/lib/acp/bus";
import type {
  AgentPermissionMode,
  AgentApprovalReviewer,
  AgentImageAttachment,
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
import { useMcpStore } from "@/lib/stores/mcpStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";

export interface AgentQueuedPrompt {
  id: string;
  text: string;
  displayText: string;
  images: AgentImageAttachment[];
  queuedAt: number;
}

interface AgentState {
  backends: AgentDetectInfo[];
  detecting: boolean;
  session: AgentSessionHandle | null;
  liveSessions: AgentSessionHandle[];
  activeLiveId: string | null;
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
  /** Explicit renames by archive id; without one the title tracks the first message. */
  sessionTitles: Record<string, string>;
  queuedPrompts: AgentQueuedPrompt[];
  /** Recovery fallback: saved timeline is visible, but no agent process is attached yet. */
  viewingArchiveId: string | null;
  detect: () => Promise<void>;
  setMode: (mode: AgentPermissionMode) => void;
  hydrateProviderId: (id: string | null) => void;
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
  prompt: (
    text: string,
    displayText?: string,
    images?: AgentImageAttachment[],
  ) => Promise<boolean>;
  queuePrompt: (
    text: string,
    displayText?: string,
    images?: AgentImageAttachment[],
    front?: boolean,
  ) => void;
  redirectPrompt: (
    text: string,
    displayText?: string,
    images?: AgentImageAttachment[],
  ) => Promise<void>;
  removeQueuedPrompt: (id: string) => void;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | "cancelled") => void;
  stop: () => Promise<void>;
  switchLiveSession: (id: string) => void;
  closeLiveSession: (id: string) => Promise<void>;
  newConversation: () => Promise<void>;
  restart: () => Promise<void>;
  refreshArchives: (projectPath: string) => Promise<void>;
  openArchive: (projectPath: string, id: string) => Promise<void>;
  clearArchiveView: () => void;
  removeArchive: (projectPath: string, id: string) => Promise<void>;
  renameSession: (projectPath: string, id: string, title: string) => Promise<void>;
}

const liveBuses = new Map<string, AgentBus>();
const liveUnsubscribers = new Map<string, () => void>();
const pendingActiveBuses = new Set<AgentBus>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
let catalogRequestId = 0;

function schedulePersist(session: AgentSessionHandle | null) {
  if (!session || session.items.length === 0) return;
  const existing = persistTimers.get(session.archiveId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    persistTimers.delete(session.archiveId);
    void persistSession({
      id: session.archiveId,
      projectPath: session.projectPath,
      backend: session.backend,
      acpSessionId: session.acpSessionId,
      createdAt: session.createdAt,
      items: session.items,
      usage: session.usage,
      cost: session.cost,
      title: useAgentStore.getState().sessionTitles[session.archiveId],
    }).catch(() => {
      // Archive failures must not break the live session.
    });
  }, 400);
  persistTimers.set(session.archiveId, timer);
}

function activeBus(): AgentBus | null {
  const id = useAgentStore.getState().activeLiveId;
  return id ? liveBuses.get(id) ?? null : null;
}

function publishLiveSession(bus: AgentBus, session: AgentSessionHandle) {
  if (!liveBuses.has(session.archiveId)) {
    liveBuses.set(session.archiveId, bus);
  }
  useAgentStore.setState((state) => {
    const liveSessions = [
      session,
      ...state.liveSessions.filter((item) => item.archiveId !== session.archiveId),
    ].sort((a, b) => b.createdAt - a.createdAt);
    const makeActive = pendingActiveBuses.has(bus);
    const activeLiveId = makeActive ? session.archiveId : state.activeLiveId;
    if (activeLiveId !== session.archiveId) return { liveSessions, activeLiveId };
    return {
      liveSessions,
      activeLiveId,
      session,
      items: session.items,
      permission: session.permission,
      error: session.error ?? null,
      busy: session.status === "busy" || session.status === "starting",
      stderrTail: session.stderrTail,
      circuitOpen: session.circuitOpen,
      viewingArchiveId: null,
    };
  });
  schedulePersist(session);
  if (session.status === "exited" || session.status === "crashed") {
    void useAgentStore
      .getState()
      .refreshArchives(session.projectPath)
      .catch(() => undefined);
  }
}

function attachBus(bus: AgentBus): () => void {
  let archiveId: string | null = null;
  const unsubscribe = bus.subscribe((session) => {
    if (!archiveId) {
      archiveId = session.archiveId;
      liveUnsubscribers.set(archiveId, unsubscribe);
    }
    publishLiveSession(bus, session);
  });
  return () => {
    unsubscribe();
    if (archiveId) liveUnsubscribers.delete(archiveId);
  };
}

function removeLiveSession(id: string) {
  liveUnsubscribers.get(id)?.();
  liveUnsubscribers.delete(id);
  liveBuses.delete(id);
  const timer = persistTimers.get(id);
  if (timer) clearTimeout(timer);
  persistTimers.delete(id);
  useAgentStore.setState((state) => {
    const liveSessions = state.liveSessions.filter((item) => item.archiveId !== id);
    if (state.activeLiveId !== id) return { liveSessions };
    const next = liveSessions[0] ?? null;
    return {
      liveSessions,
      activeLiveId: next?.archiveId ?? null,
      session: next,
      items: next?.items ?? [],
      permission: next?.permission ?? null,
      busy: next ? next.status === "busy" || next.status === "starting" : false,
      error: next?.error ?? null,
      stderrTail: next?.stderrTail ?? [],
      circuitOpen: next?.circuitOpen ?? false,
      queuedPrompts: [],
    };
  });
}

async function stopLiveBus(id: string): Promise<AgentSessionHandle | null> {
  const bus = liveBuses.get(id);
  if (!bus) return null;
  const live = bus.getSession();
  if (live && live.items.length > 0) {
    await persistSession({
      id: live.archiveId,
      projectPath: live.projectPath,
      backend: live.backend,
      acpSessionId: live.acpSessionId,
      createdAt: live.createdAt,
      items: live.items,
      usage: live.usage,
      cost: live.cost,
      title: useAgentStore.getState().sessionTitles[live.archiveId],
    });
  }
  await bus.stop();
  removeLiveSession(id);
  return live;
}

function pickReadyBackend(backends: AgentDetectInfo[], preferred: StartableBackend): StartableBackend {
  if (preferred.startsWith("custom:") && useHarnessStore.getState().harnesses.some((item) => `custom:${item.id}` === preferred)) {
    return preferred;
  }
  const preferredInfo = backends.find((b) => b.backend === preferred);
  if (preferredInfo?.installed) return preferred;
  const order: StartableBackend[] = ["codex-acp", "claude-acp", "opencode-acp", "pi-agent"];
  for (const id of order) {
    if (backends.some((b) => b.backend === id && b.installed)) return id;
  }
  return "auto";
}

export const useAgentStore = create<AgentState>((set, get) => ({
  backends: [],
  detecting: false,
  session: null,
  liveSessions: [],
  activeLiveId: null,
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
  sessionTitles: {},
  queuedPrompts: [],
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

  hydrateProviderId: (providerId) => {
    if (get().providerId === providerId) return;
    set({ providerId, catalog: null, catalogError: null });
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
      const bus = activeBus();
      if (!bus) throw new Error("No running agent session");
      await bus.configure({
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
    activeBus()?.clearCircuit();
    set({ circuitOpen: false, error: null });
  },

  start: async (cwd, restore) => {
    if (get().backend === "auto" || get().backends.length === 0) {
      await get().detect();
    }
    if (get().liveSessions.length >= 8) {
      set({ error: "Close a live conversation before starting another (limit: 8)." });
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
    if ((!custom && !info) || (info && !info.installed)) {
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
    set({
      busy: true,
      error: null,
      stderrTail: [],
      viewingArchiveId: null,
      session: null,
      items: restore?.items ?? [],
      permission: null,
      activeLiveId: null,
      queuedPrompts: [],
    });
    const bus = new AgentBus();
    pendingActiveBuses.add(bus);
    const detach = attachBus(bus);
    try {
      const mcpServers = await useMcpStore.getState().enabledForSession();
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
        mcpServers,
        harness: custom
          ? {
              protocol: custom.protocol,
              command: custom.command || null,
              args: custom.args,
              env: custom.env,
              endpoint: custom.endpoint ?? null,
              model: custom.model ?? null,
            }
          : info
            ? {
                protocol: info.protocol as CustomAgentProtocol,
                command: info.command,
                args: info.args,
              }
            : undefined,
      };
      const session = await bus.start(get().backend, projectPath, options);
      pendingActiveBuses.delete(bus);
      set({
        activeLiveId: session.archiveId,
        session,
        items: session.items,
        permission: session.permission,
        busy: false,
        stderrTail: session.stderrTail,
      });
      await get().refreshArchives(projectPath);
    } catch (error) {
      pendingActiveBuses.delete(bus);
      const failed = bus.getSession();
      const failedId =
        failed?.archiveId ??
        [...liveBuses.entries()].find(([, candidate]) => candidate === bus)?.[0] ??
        null;
      detach();
      if (failedId) {
        liveBuses.delete(failedId);
        liveUnsubscribers.delete(failedId);
        set((state) => ({
          liveSessions: state.liveSessions.filter(
            (item) => item.archiveId !== failedId,
          ),
        }));
      }
      await bus.stop().catch(() => undefined);
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
        stderrTail: failed?.stderrTail ?? get().stderrTail,
        activeLiveId: null,
      });
    }
  },

  prompt: async (text, displayText, images = []) => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return false;
    const visibleText =
      displayText?.trim() ||
      trimmed ||
      (images.length === 1 ? `Image: ${images[0].name}` : `${images.length} images`);
    const bus = activeBus();
    const liveId = get().activeLiveId;
    if (!bus || !liveId) {
      set({ error: "No running agent session — start one first." });
      return false;
    }
    set({ busy: true, error: null });
    const projectPath =
      bus.getSession()?.projectPath ??
      useProjectStore.getState().current?.path ??
      null;
    let turnId: string | null = null;
    if (projectPath) {
      try {
        const turn = await ipc.ckptBeginTurn(projectPath, visibleText.slice(0, 48));
        turnId = turn.id;
      } catch {
        // Checkpoints are best-effort — continue the prompt without them.
      }
    }
    let succeeded = false;
    try {
      await bus.prompt(trimmed, {
        displayText: visibleText,
        checkpointId: turnId,
        images,
      });
      succeeded = true;
      if (get().activeLiveId === liveId) set({ busy: false });
      const session = bus.getSession();
      if (session) {
        await persistSession({
          id: session.archiveId,
          projectPath: session.projectPath,
          backend: session.backend,
          acpSessionId: session.acpSessionId,
          createdAt: session.createdAt,
          items: session.items,
          usage: session.usage,
          cost: session.cost,
          title: get().sessionTitles[session.archiveId],
        });
        await get().refreshArchives(session.projectPath);
      }
    } catch (error) {
      if (get().activeLiveId === liveId) {
        set({
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (projectPath) {
        try {
          const meta = await ipc.ckptCommitTurn(projectPath, turnId);
          useReviewStore.getState().ingestTurn(meta);
        } catch {
          // ignore commit failures
        }
      }
      const session = bus.getSession();
      const next = get().queuedPrompts[0];
      if (
        get().activeLiveId === liveId &&
        next &&
        session &&
        !["crashed", "exited"].includes(session.status)
      ) {
        set((state) => ({
          queuedPrompts: state.queuedPrompts.filter((item) => item.id !== next.id),
        }));
        queueMicrotask(() => {
          void get().prompt(next.text, next.displayText, next.images);
        });
      }
    }
    return succeeded;
  },

  queuePrompt: (text, displayText, images = [], front = false) => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    const item: AgentQueuedPrompt = {
      id: globalThis.crypto?.randomUUID?.() ?? `queued-${Date.now()}-${Math.random()}`,
      text: trimmed,
      displayText:
        displayText?.trim() ||
        trimmed ||
        (images.length === 1 ? `Image: ${images[0].name}` : `${images.length} images`),
      images,
      queuedAt: Date.now(),
    };
    set((state) => ({
      queuedPrompts: front
        ? [item, ...state.queuedPrompts]
        : [...state.queuedPrompts, item],
    }));
  },

  redirectPrompt: async (text, displayText, images = []) => {
    get().queuePrompt(text, displayText, images, true);
    await get().cancel();
  },

  removeQueuedPrompt: (id) =>
    set((state) => ({
      queuedPrompts: state.queuedPrompts.filter((item) => item.id !== id),
    })),

  cancel: async () => {
    await activeBus()?.cancel();
  },

  respondPermission: (optionId) => {
    activeBus()?.respondPermission(optionId);
  },

  stop: async () => {
    const liveId = get().activeLiveId;
    if (!liveId) return;
    set({ busy: true });
    try {
      const live = await stopLiveBus(liveId);
      if (live) await get().refreshArchives(live.projectPath);
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  newConversation: async () => {
    set({
      activeLiveId: null,
      session: null,
      items: [],
      permission: null,
      busy: false,
      error: null,
      viewingArchiveId: null,
      stderrTail: [],
      queuedPrompts: [],
    });
  },

  switchLiveSession: (id) => {
    const bus = liveBuses.get(id);
    const session = bus?.getSession();
    if (!session) return;
    set({
      activeLiveId: id,
      session,
      items: session.items,
      permission: session.permission,
      busy: session.status === "busy" || session.status === "starting",
      error: session.error ?? null,
      viewingArchiveId: null,
      stderrTail: session.stderrTail,
      circuitOpen: session.circuitOpen,
      queuedPrompts: [],
    });
  },

  closeLiveSession: async (id) => {
    try {
      const live = await stopLiveBus(id);
      if (live) await get().refreshArchives(live.projectPath);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  restart: async () => {
    const bus = activeBus();
    const live = bus?.getSession() ?? null;
    if (!bus || !live) return;
    if (bus.isCircuitOpen() || get().circuitOpen) {
      set({
        circuitOpen: true,
        error:
          "Circuit open: too many crashes. Reset the breaker, then restart.",
      });
      return;
    }
    const restore: AgentSessionRestore = {
      archiveId: live.archiveId,
      acpSessionId: live.acpSessionId,
      createdAt: live.createdAt,
      items: live.items,
      usage: live.usage,
      cost: live.cost,
    };
    await stopLiveBus(live.archiveId);
    await get().start(live.projectPath, restore);
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
      if (liveBuses.has(id)) {
        get().switchLiveSession(id);
        return;
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
        usage: meta.usage
          ? {
              totalTokens: meta.usage.totalTokens,
              inputTokens: meta.usage.inputTokens,
              outputTokens: meta.usage.outputTokens,
              thoughtTokens: meta.usage.thoughtTokens ?? undefined,
              cachedReadTokens: meta.usage.cachedReadTokens ?? undefined,
              cachedWriteTokens: meta.usage.cachedWriteTokens ?? undefined,
            }
          : null,
        cost: meta.cost ?? null,
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
    if (liveBuses.has(id)) {
      set({ error: "Stop the live conversation before deleting its archive." });
      return;
    }
    await deleteArchive(projectPath, id);
    if (get().viewingArchiveId === id) {
      set({ viewingArchiveId: null, items: [] });
    }
    set((state) => {
      const { [id]: _dropped, ...rest } = state.sessionTitles;
      return { sessionTitles: rest };
    });
    await get().refreshArchives(projectPath);
  },

  renameSession: async (projectPath, id, title) => {
    const next = title.trim();
    if (!next) return;
    // Remember it first: a live conversation re-saves on a timer and would
    // otherwise overwrite the rename with the first-message title.
    set((state) => ({ sessionTitles: { ...state.sessionTitles, [id]: next } }));
    const live = liveBuses.get(id)?.getSession();
    if (live && live.items.length > 0) {
      await persistSession({
        id: live.archiveId,
        projectPath: live.projectPath,
        backend: live.backend,
        acpSessionId: live.acpSessionId,
        createdAt: live.createdAt,
        items: live.items,
        usage: live.usage,
        cost: live.cost,
        title: next,
      });
    } else {
      await renameArchive(projectPath, id, next);
    }
    await get().refreshArchives(projectPath);
  },
}));
