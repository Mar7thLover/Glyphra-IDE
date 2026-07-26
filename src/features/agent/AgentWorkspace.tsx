import {
  AppWindow,
  Loader2,
  MessageSquarePlus,
  PanelRightClose,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import GlyphMark from "@/app/GlyphMark";
import { sessionLabel } from "@/lib/acp/archive";
import { openAgentsWindow } from "@/lib/agentWindow";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useComposerDraft } from "@/lib/stores/composerStore";
import { useHarnessStore } from "@/lib/stores/harnessStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";
import { useUiStore } from "@/lib/stores/uiStore";

import AgentComposer from "./AgentComposer";
import MessageList from "./MessageList";
import Notice from "./Notice";
import PermissionModal from "./PermissionModal";
import SessionList from "./SessionList";

export const AGENT_WIDTH = 380;

function EmptyState({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const setDraft = useComposerDraft((s) => s.setDraft);
  const tips = [t("home.tipReview"), t("home.tipExplain"), t("home.tipTest")];

  return (
    <div className="rise-in flex h-full flex-col items-center justify-center gap-3 px-6 pb-10">
      <GlyphMark size={34} className="opacity-80" />
      <div className="text-center">
        <div className="text-[14px] font-medium text-ink">{t("agent.emptyHello")}</div>
        <p className="mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-ink-3">
          {ready ? t("agent.emptyBody") : t("agent.needInstall")}
        </p>
      </div>
      {ready && (
        <div className="mt-2 flex flex-col items-stretch gap-1.5">
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
      )}
    </div>
  );
}

/**
 * Right-hand Agent workspace — input-first, readiness-aware chat surface.
 */
export default function AgentWorkspace() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.agentOpen);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);
  const openSettings = useUiStore((s) => s.openSettings);

  const current = useProjectStore((s) => s.current);
  const session = useAgentStore((s) => s.session);
  const liveSessions = useAgentStore((s) => s.liveSessions);
  const items = useAgentStore((s) => s.items);
  const permission = useAgentStore((s) => s.permission);
  const busy = useAgentStore((s) => s.busy);
  const error = useAgentStore((s) => s.error);
  const mode = useAgentStore((s) => s.mode);
  const backend = useAgentStore((s) => s.backend);
  const backends = useAgentStore((s) => s.backends);
  const detecting = useAgentStore((s) => s.detecting);
  const stderrTail = useAgentStore((s) => s.stderrTail);
  const circuitOpen = useAgentStore((s) => s.circuitOpen);
  const archives = useAgentStore((s) => s.archives);
  const sessionTitles = useAgentStore((s) => s.sessionTitles);
  const viewingArchiveId = useAgentStore((s) => s.viewingArchiveId);
  const detect = useAgentStore((s) => s.detect);
  const setMode = useAgentStore((s) => s.setMode);
  const clearError = useAgentStore((s) => s.clearError);
  const clearCircuit = useAgentStore((s) => s.clearCircuit);
  const start = useAgentStore((s) => s.start);
  const respondPermission = useAgentStore((s) => s.respondPermission);
  const newConversation = useAgentStore((s) => s.newConversation);
  const restart = useAgentStore((s) => s.restart);
  const refreshArchives = useAgentStore((s) => s.refreshArchives);
  const openArchive = useAgentStore((s) => s.openArchive);
  const clearArchiveView = useAgentStore((s) => s.clearArchiveView);
  const removeArchive = useAgentStore((s) => s.removeArchive);
  const renameSession = useAgentStore((s) => s.renameSession);
  const switchLiveSession = useAgentStore((s) => s.switchLiveSession);
  const closeLiveSession = useAgentStore((s) => s.closeLiveSession);
  const refreshProviders = useProviderStore((s) => s.refresh);
  const customHarnesses = useHarnessStore((s) => s.harnesses);
  const resetComposer = useComposerDraft((s) => s.reset);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void detect();
    void refreshProviders();
    const prefs = usePrefsStore.getState();
    setMode(prefs.defaultMode);
  }, [detect, refreshProviders, setMode]);

  useEffect(() => {
    if (!current?.path) return;
    void refreshArchives(current.path);
    const active = useAgentStore.getState().session;
    if (active && active.projectPath !== current.path) {
      void useAgentStore.getState().newConversation();
    }
  }, [current?.path, refreshArchives]);

  const projectLiveSessions = liveSessions.filter(
    (live) => live.projectPath === current?.path,
  );

  const backendInfo = backends.find((b) => b.backend === backend);
  const backendReady =
    backend === "fixture" ||
    Boolean(backendInfo?.installed) ||
    (backend.startsWith("custom:") &&
      customHarnesses.some((item) => `custom:${item.id}` === backend));

  const running = session?.status === "running" || session?.status === "busy";
  const crashed = session?.status === "crashed";
  const isFixture = backend === "fixture";
  const readOnly = Boolean(viewingArchiveId);
  const hasConversation = Boolean(
    session ||
      viewingArchiveId ||
      items.some((item) => item.kind === "user" || item.kind === "assistant"),
  );

  const statusTone = running ? "live" : crashed ? "crashed" : "idle";
  const statusLabel = detecting
    ? t("agent.detecting")
    : session?.status === "busy"
      ? t("agent.statusBusy")
      : session?.status === "running"
        ? t("agent.statusLive")
        : crashed
          ? t("agent.statusCrashed")
          : readOnly
            ? t("agent.sessionArchive")
            : backendReady
              ? t("agent.ready")
              : t("agent.missing");

  const headerLabel = readOnly
    ? (archives.find((entry) => entry.id === viewingArchiveId)?.title ?? t("agent.sessionArchive"))
    : sessionLabel(
        items,
        session ? sessionTitles[session.archiveId] : null,
        session?.agentName ??
          (session?.acpSessionId ? session.acpSessionId.slice(0, 8) : t("agent.newAgent")),
      );

  const iconBtn =
    "grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-30";

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? AGENT_WIDTH : 0 }}
      transition={{ type: "spring", stiffness: 480, damping: 44 }}
      className="glass-panel relative shrink-0 overflow-hidden border-l border-line"
    >
      <div className="relative flex h-full flex-col" style={{ width: AGENT_WIDTH }}>
        <header className="flex h-10 shrink-0 items-center gap-1.5 px-2">
          <SessionList
            archives={archives}
            liveSessions={projectLiveSessions}
            activeId={session?.archiveId ?? null}
            viewingId={viewingArchiveId}
            onOpen={(id) => {
              if (!current) return;
              void openArchive(current.path, id);
            }}
            onDelete={(id) => {
              if (!current) return;
              void removeArchive(current.path, id);
            }}
            onSwitchLive={switchLiveSession}
            onCloseLive={(id) => {
              if (!window.confirm(t("agent.stopBackgroundConfirm"))) return;
              void closeLiveSession(id);
            }}
            onRename={(id, title) => {
              if (!current) return;
              void renameSession(current.path, id, title);
            }}
          />
          <span className="min-w-0 truncate text-[12px] font-medium text-ink" title={headerLabel}>
            {headerLabel}
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${
              statusTone === "live"
                ? "bg-accent-soft text-accent"
                : statusTone === "crashed"
                  ? "bg-danger/12 text-danger"
                  : "bg-hover text-ink-3"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                statusTone === "live"
                  ? "status-pulse bg-accent"
                  : statusTone === "crashed"
                    ? "bg-danger"
                    : "bg-ink-3/50"
              }`}
            />
            {statusLabel}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            title={t("agent.detect")}
            onClick={() => void detect()}
            className={iconBtn}
          >
            <RefreshCw className={`size-3.5 ${detecting ? "animate-spin" : ""}`} strokeWidth={1.6} />
          </button>
          {crashed ? (
            <button
              type="button"
              disabled={!current || busy || circuitOpen}
              onClick={() => void restart()}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-hover disabled:opacity-40"
            >
              {t("agent.restart")}
            </button>
          ) : hasConversation ? (
            <button
              type="button"
              onClick={() => {
                void newConversation().then(() => resetComposer());
              }}
              title={t("agent.newConversationHint")}
              className={iconBtn}
            >
              <MessageSquarePlus className="size-3.5" strokeWidth={1.6} />
            </button>
          ) : (
            <button
              type="button"
              disabled={!current || busy || !backendReady || circuitOpen}
              onClick={() => {
                if (readOnly) clearArchiveView();
                if (current) void start(current.path);
              }}
              title={circuitOpen ? t("agent.circuitOpen") : t("agent.start")}
              className={iconBtn}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" strokeWidth={1.6} />
              )}
            </button>
          )}
          <button
            type="button"
            title={t("agent.openWindow")}
            onClick={() => void openAgentsWindow()}
            className={iconBtn}
          >
            <AppWindow className="size-3.5" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            title={t("agent.toggleHide")}
            onClick={() => setAgentOpen(false)}
            className={iconBtn}
          >
            <PanelRightClose className="size-3.5" strokeWidth={1.6} />
          </button>
        </header>

        {busy ? <div className="thinking-bar" /> : <div className="h-px bg-line" />}

        {mode === "unleashed" && (
          <Notice tone="danger">
            <span>{t("agent.modeUnleashedWarn")}</span>
          </Notice>
        )}

        {isFixture && !running && !readOnly && (
          <Notice>
            <span>{t("agent.fixtureHint")}</span>
          </Notice>
        )}

        {!backendReady && backendInfo && (
          <Notice tone="danger">
            <span className="min-w-0">{backendInfo.detail}</span>
            <button
              type="button"
              onClick={() => openSettings()}
              className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
            >
              {t("agent.openSetup")}
            </button>
          </Notice>
        )}

        {readOnly && (
          <Notice>
            <span>{t("agent.sessionReadonly")}</span>
            <button
              type="button"
              disabled={!current || busy}
              onClick={() => {
                if (current && viewingArchiveId) {
                  void openArchive(current.path, viewingArchiveId);
                }
              }}
              className="shrink-0 text-ink-2 hover:text-ink"
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

        {(crashed || circuitOpen) && stderrTail.length > 0 && (
          <pre className="mx-3 mt-2 max-h-24 overflow-auto rounded-lg border border-line bg-app/50 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-ink-3">
            {stderrTail.join("\n")}
          </pre>
        )}

        <div className="min-h-0 flex-1">
          {items.length === 0 ? (
            !current ? (
              <div className="flex h-full items-center justify-center px-6 pb-10">
                <p className="max-w-[240px] text-center text-[12px] leading-relaxed text-ink-3">
                  {t("agent.needProject")}
                </p>
              </div>
            ) : (
              <EmptyState ready={backendReady} />
            )
          ) : (
            <MessageList items={items} />
          )}
        </div>

        <AgentComposer />

        {permission && <PermissionModal prompt={permission} onRespond={respondPermission} />}
      </div>
    </motion.aside>
  );
}
