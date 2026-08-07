import { useEffect, useRef, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Check,
  Folder,
  FolderOpen,
  History,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import GlyphMark from "@/app/GlyphMark";
import { MacWindowControls, WindowControls } from "@/app/TitleBar";
import AgentComposer from "@/features/agent/AgentComposer";
import MessageList from "@/features/agent/MessageList";
import Notice from "@/features/agent/Notice";
import PermissionModal from "@/features/agent/PermissionModal";
import SessionTitleInput from "@/features/agent/SessionTitleInput";
import { sessionLabel } from "@/lib/acp/archive";
import { AGENT_WINDOW_PROJECT_KEY } from "@/lib/agentWindow";
import { applyAppearanceSettings } from "@/lib/appearance";
import { ipc, type AppSettings, type RecentProject } from "@/lib/ipc/ipc";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useComposerDraft } from "@/lib/stores/composerStore";
import { useHarnessStore } from "@/lib/stores/harnessStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProviderStore } from "@/lib/stores/providerStore";
import { useUiStore } from "@/lib/stores/uiStore";

const win = getCurrentWindow();

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.07em] text-ink-3">
      {children}
    </div>
  );
}

/**
 * Standalone Agents window — a focused, Cursor-style surface for steering
 * agents without the IDE around them. Routes here when window label = "agent".
 */
export default function AgentWindowApp() {
  const { t } = useTranslation();
  const setMica = useUiStore((s) => s.setMica);
  const current = useProjectStore((s) => s.current);

  const session = useAgentStore((s) => s.session);
  const liveSessions = useAgentStore((s) => s.liveSessions);
  const items = useAgentStore((s) => s.items);
  const permission = useAgentStore((s) => s.permission);
  const busy = useAgentStore((s) => s.busy);
  const error = useAgentStore((s) => s.error);
  const backend = useAgentStore((s) => s.backend);
  const backends = useAgentStore((s) => s.backends);
  const circuitOpen = useAgentStore((s) => s.circuitOpen);
  const archives = useAgentStore((s) => s.archives);
  const viewingArchiveId = useAgentStore((s) => s.viewingArchiveId);
  const clearError = useAgentStore((s) => s.clearError);
  const clearCircuit = useAgentStore((s) => s.clearCircuit);
  const respondPermission = useAgentStore((s) => s.respondPermission);
  const stop = useAgentStore((s) => s.stop);
  const newConversation = useAgentStore((s) => s.newConversation);
  const restart = useAgentStore((s) => s.restart);
  const refreshArchives = useAgentStore((s) => s.refreshArchives);
  const openArchive = useAgentStore((s) => s.openArchive);
  const clearArchiveView = useAgentStore((s) => s.clearArchiveView);
  const removeArchive = useAgentStore((s) => s.removeArchive);
  const renameSession = useAgentStore((s) => s.renameSession);
  const sessionTitles = useAgentStore((s) => s.sessionTitles);
  const switchLiveSession = useAgentStore((s) => s.switchLiveSession);
  const closeLiveSession = useAgentStore((s) => s.closeLiveSession);
  const setDraft = useComposerDraft((s) => s.setDraft);
  const resetComposer = useComposerDraft((s) => s.reset);

  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [switching, setSwitching] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const customHarnesses = useHarnessStore((s) => s.harnesses);
  const booted = useRef(false);
  const closing = useRef(false);

  const running = session?.status === "running" || session?.status === "busy";
  const crashed = session?.status === "crashed";
  const projectLiveSessions = liveSessions.filter(
    (live) => live.projectPath === current?.path,
  );
  const backendInfo = backends.find((b) => b.backend === backend);
  const backendReady =
    Boolean(backendInfo?.installed) ||
    (backend.startsWith("custom:") &&
      customHarnesses.some((item) => `custom:${item.id}` === backend));
  const inChat = items.length > 0 || running || crashed;

  const selectProject = async (path: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      if (useAgentStore.getState().session) await stop();
      clearArchiveView();
      const info = await ipc.projectOpen(path);
      useProjectStore.setState({ current: info });
      const active = useAgentStore.getState().session;
      if (active && active.projectPath !== info.path) {
        await useAgentStore.getState().newConversation();
      }
      localStorage.setItem(AGENT_WINDOW_PROJECT_KEY, info.path);
      setRecents(await ipc.projectRecent());
      await refreshArchives(info.path);
    } catch {
      // Project may have moved — refresh the recents list.
      setRecents(await ipc.projectRecent().catch(() => []));
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const settings = await ipc.settingsGet();
        applyAppearanceSettings(settings, { persistLanguage: false });
        usePrefsStore.getState().hydrate(settings);
        useAgentStore
          .getState()
          .hydrateProviderId(usePrefsStore.getState().defaultProviderId);
      } catch {
        // index.html FOUC path already applied a theme
      }
      const env = await ipc.appReady();
      setMica(env.mica);
      useUiStore.getState().setHostOs(env.os);
      void useAgentStore.getState().detect();
      void useProviderStore.getState().refresh();

      const handoff = localStorage.getItem(AGENT_WINDOW_PROJECT_KEY);
      const list = await ipc.projectRecent().catch(() => [] as RecentProject[]);
      setRecents(list);
      const initial = handoff ?? list[0]?.path;
      if (initial) await selectProject(initial);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void listen<AppSettings>("settings-changed", (event) => {
      const settings = event.payload;
      applyAppearanceSettings(settings);
      usePrefsStore.getState().hydrate(settings);
      useAgentStore
        .getState()
        .hydrateProviderId(usePrefsStore.getState().defaultProviderId);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void listen("prepare-restart", async () => {
      const state = useAgentStore.getState();
      const ids = state.liveSessions.map((session) => session.archiveId);
      await Promise.all(ids.map((id) => state.closeLiveSession(id)));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // A live agent must not outlive its window: stop (and archive) on close.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void win
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing.current) return;
        closing.current = true;
        try {
          const state = useAgentStore.getState();
          const ids = state.liveSessions.map((session) => session.archiveId);
          if (ids.length > 0) {
            await Promise.race([
              Promise.all(ids.map((id) => state.closeLiveSession(id))).then(() => undefined),
              new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
            ]);
          }
        } finally {
          await win.destroy();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
    if (typeof dir === "string") await selectProject(dir);
  };

  const newSession = async () => {
    await newConversation();
    resetComposer();
  };

  const tips = [t("home.tipReview"), t("home.tipExplain"), t("home.tipTest")];

  return (
    <div className="relative flex h-full flex-col bg-app text-ink">
      <header
        data-tauri-drag-region
        className="glass-panel relative z-50 flex h-10 shrink-0 items-stretch border-b border-line"
      >
        <MacWindowControls />
        <div data-tauri-drag-region className="flex items-center gap-2 pl-3.5 pr-2">
          <GlyphMark size={15} className="pointer-events-none" />
          <span className="pointer-events-none text-[11px] font-medium tracking-wide text-ink-2">
            {t("agentWindow.title")}
          </span>
        </div>
        <div data-tauri-drag-region className="flex-1" />
        <div className="flex items-center pr-1.5">
          <button
            type="button"
            onClick={() => void ipc.windowFocusMain()}
            className="my-1.5 inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-raised/70 px-2.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            IDE
            <ArrowUpRight className="size-3" strokeWidth={1.8} />
          </button>
        </div>
        <WindowControls />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ------- Sessions / projects sidebar ------- */}
        <aside className="glass-panel flex w-60 shrink-0 flex-col border-r border-line">
          <div className="px-2 pt-2">
            <button
              type="button"
              onClick={() => void newSession()}
              className="flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-raised/60 px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-raised"
            >
              <Plus className="size-3.5 text-ink-2" strokeWidth={1.8} />
              {t("agentWindow.newSession")}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <SectionLabel>{t("agentWindow.projects")}</SectionLabel>
            <ul className="space-y-px">
              {recents.slice(0, 8).map((project) => {
                const active = current?.path === project.path;
                return (
                  <li key={project.path}>
                    <button
                      type="button"
                      onClick={() => void selectProject(project.path)}
                      title={project.path}
                      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] transition-colors ${
                        active ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
                      }`}
                    >
                      {active ? (
                        <FolderOpen className="size-3.5 shrink-0 text-accent" strokeWidth={1.6} />
                      ) : (
                        <Folder className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.6} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      {active && <Check className="size-3 shrink-0 text-accent" strokeWidth={2} />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => void pickFolder()}
              className="mt-1 flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
            >
              <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.6} />
              {t("empty.openFolder")}…
            </button>

            <SectionLabel>{t("agent.sessions")}</SectionLabel>
            {projectLiveSessions.map((live) => {
              const selected = session?.archiveId === live.archiveId;
              const label = sessionLabel(
                live.items,
                sessionTitles[live.archiveId],
                live.agentName ?? live.acpSessionId?.slice(0, 8) ?? live.backend,
              );
              return (
                <div key={live.archiveId} className="group flex items-stretch">
                  <button
                    type="button"
                    onClick={() => switchLiveSession(live.archiveId)}
                    onDoubleClick={() => setRenamingId(live.archiveId)}
                    className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover ${
                      selected ? "bg-active" : ""
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          live.status === "busy" ? "status-pulse bg-accent" : "bg-ok"
                        }`}
                      />
                      {renamingId === live.archiveId ? (
                        <SessionTitleInput
                          initial={label}
                          onCommit={(title) => {
                            setRenamingId(null);
                            if (current) void renameSession(current.path, live.archiveId, title);
                          }}
                          onCancel={() => setRenamingId(null)}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                          {label}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    title={t("agent.sessionRename")}
                    onClick={() => setRenamingId(live.archiveId)}
                    className="px-1 text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100"
                  >
                    <Pencil className="size-3" strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    title={t("agent.stop")}
                    onClick={() => {
                      if (window.confirm(t("agent.stopBackgroundConfirm"))) {
                        void closeLiveSession(live.archiveId);
                      }
                    }}
                    className="pr-1.5 text-ink-3 opacity-0 hover:text-danger group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
            {archives.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-ink-3">{t("agent.sessionsEmpty")}</p>
            ) : (
              <ul className="space-y-px">
                {archives
                  .filter(
                    (archive) =>
                      !projectLiveSessions.some((live) => live.archiveId === archive.id),
                  )
                  .map((archive) => {
                  const selected =
                    viewingArchiveId === archive.id || session?.archiveId === archive.id;
                  return (
                    <li key={archive.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (!current) return;
                          void openArchive(current.path, archive.id);
                        }}
                        onDoubleClick={() => setRenamingId(archive.id)}
                        className={`w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover ${
                          selected ? "bg-active" : ""
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <History className="size-3 shrink-0 text-ink-3" strokeWidth={1.6} />
                          {renamingId === archive.id ? (
                            <SessionTitleInput
                              initial={archive.title}
                              onCommit={(title) => {
                                setRenamingId(null);
                                if (current) void renameSession(current.path, archive.id, title);
                              }}
                              onCancel={() => setRenamingId(null)}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                              {archive.title}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate pl-[18px] text-[10px] text-ink-3">
                          {archive.backend} · {formatWhen(archive.updatedAt)}
                        </div>
                      </button>
                      <div className="absolute right-1.5 top-1.5 flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          title={t("agent.sessionRename")}
                          onClick={() => setRenamingId(archive.id)}
                          className="rounded p-1 text-ink-3 hover:text-ink"
                        >
                          <Pencil className="size-3" strokeWidth={1.6} />
                        </button>
                        <button
                          type="button"
                          title={t("agent.sessionDelete")}
                          onClick={() => {
                            if (!current) return;
                            void removeArchive(current.path, archive.id);
                          }}
                          className="rounded p-1 text-ink-3 hover:text-danger"
                        >
                          <Trash2 className="size-3" strokeWidth={1.6} />
                        </button>
                      </div>
                    </li>
                  );
                  })}
              </ul>
            )}
          </div>
        </aside>

        {/* ------- Main surface ------- */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {busy && <div className="thinking-bar absolute inset-x-0 top-0 z-10" />}

          {inChat || viewingArchiveId ? (
            <>
              <div className="mx-auto flex w-full max-w-[860px] min-h-0 flex-1 flex-col px-2 pt-2">
                <MessageList items={items} />
              </div>
              <div className="mx-auto w-full max-w-[860px]">
                {viewingArchiveId && (
                  <Notice>
                    <span>{t("agent.sessionReadonly")}</span>
                    <button
                      type="button"
                      disabled={!current || busy}
                      onClick={() => {
                        if (current) void openArchive(current.path, viewingArchiveId);
                      }}
                      className="shrink-0 text-ink-2 hover:text-ink"
                    >
                      {t("agent.restart")}
                    </button>
                  </Notice>
                )}
                {crashed && (
                  <Notice tone="danger">
                    <span>{t("agent.crashed")}</span>
                    <button
                      type="button"
                      disabled={circuitOpen}
                      onClick={() => void restart()}
                      className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                    >
                      {t("agent.restart")}
                    </button>
                  </Notice>
                )}
                {error && (
                  <Notice tone="danger">
                    <span className="min-w-0 flex-1">{error}</span>
                    <button
              type="button"
              aria-label={t("agent.dismissError")}
              onClick={clearError}
              className="shrink-0 hover:opacity-80"
            >
                      <X className="size-3" />
                    </button>
                  </Notice>
                )}
                {circuitOpen && (
                  <Notice tone="danger">
                    <span className="min-w-0">{t("agent.circuitOpen")}</span>
                    <button
                      type="button"
                      onClick={clearCircuit}
                      className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
                    >
                      {t("agent.circuitReset")}
                    </button>
                  </Notice>
                )}
                <AgentComposer cwd={current?.path} />
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6">
              <div className="rise-in flex w-full max-w-[640px] flex-col items-center">
                <GlyphMark size={44} />
                <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-ink">
                  {t("agent.emptyHello")}
                </h1>
                <p className="mt-1.5 text-[12px] text-ink-3">
                  {switching ? (
                    <Loader2 className="inline size-3 animate-spin" />
                  ) : current ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Folder className="size-3" strokeWidth={1.6} />
                      {current.name}
                    </span>
                  ) : (
                    t("agentWindow.noProject")
                  )}
                </p>

                <div className="mt-5 w-full">
                  {!backendReady && backendInfo && (
                    <Notice tone="danger">
                      <span>{backendInfo.detail || t("agent.needInstall")}</span>
                    </Notice>
                  )}
                  {error && (
                    <Notice tone="danger">
                      <span className="min-w-0 flex-1">{error}</span>
                      <button
                        type="button"
                        aria-label={t("agent.dismissError")}
                        onClick={clearError}
                        className="shrink-0 hover:opacity-80"
                      >
                        <X className="size-3" />
                      </button>
                    </Notice>
                  )}
                  <AgentComposer cwd={current?.path} />
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {tips.map((tip) => (
                    <button
                      key={tip}
                      type="button"
                      onClick={() => setDraft(tip)}
                      className="rounded-full border border-line bg-raised/50 px-3 py-1.5 text-[11px] text-ink-2 transition-all duration-150 hover:border-line-strong hover:bg-raised hover:text-ink"
                    >
                      {tip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {permission && <PermissionModal prompt={permission} onRespond={respondPermission} />}
        </main>
      </div>
    </div>
  );
}
