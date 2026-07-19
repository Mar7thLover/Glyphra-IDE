import {
  ArrowUpRight,
  Loader2,
  Plus,
  PanelRightClose,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { AgentPermissionMode, StartableBackend } from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";
import { useUiStore } from "@/lib/stores/uiStore";

import MessageList from "./MessageList";
import PermissionModal from "./PermissionModal";

export const AGENT_WIDTH = 380;

const pillSelect =
  "h-6 max-w-[9rem] cursor-pointer appearance-none truncate rounded-full border border-line bg-raised/80 px-2.5 text-[11px] text-ink-2 outline-none hover:border-line-strong hover:text-ink disabled:opacity-40";

function providerCompatible(backend: StartableBackend, kind: string): boolean {
  if (!kind) return true;
  if (backend === "fixture") return true;
  if (backend === "codex-acp") {
    return kind === "custom-openai" || kind === "openai-key" || kind === "codex-login";
  }
  if (backend === "claude-acp") {
    return kind === "anthropic-key" || kind === "claude-subscription";
  }
  return true;
}

/**
 * Right-hand Agent workspace — input-first, readiness-aware composer.
 */
export default function AgentWorkspace() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.agentOpen);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);
  const openSettings = useUiStore((s) => s.openSettings);

  const current = useProjectStore((s) => s.current);
  const session = useAgentStore((s) => s.session);
  const items = useAgentStore((s) => s.items);
  const permission = useAgentStore((s) => s.permission);
  const busy = useAgentStore((s) => s.busy);
  const error = useAgentStore((s) => s.error);
  const mode = useAgentStore((s) => s.mode);
  const providerId = useAgentStore((s) => s.providerId);
  const backend = useAgentStore((s) => s.backend);
  const backends = useAgentStore((s) => s.backends);
  const detecting = useAgentStore((s) => s.detecting);
  const stderrTail = useAgentStore((s) => s.stderrTail);
  const detect = useAgentStore((s) => s.detect);
  const setMode = useAgentStore((s) => s.setMode);
  const setProviderId = useAgentStore((s) => s.setProviderId);
  const setBackend = useAgentStore((s) => s.setBackend);
  const clearError = useAgentStore((s) => s.clearError);
  const start = useAgentStore((s) => s.start);
  const prompt = useAgentStore((s) => s.prompt);
  const cancel = useAgentStore((s) => s.cancel);
  const respondPermission = useAgentStore((s) => s.respondPermission);
  const stop = useAgentStore((s) => s.stop);
  const restart = useAgentStore((s) => s.restart);
  const providers = useProviderStore((s) => s.providers);
  const refreshProviders = useProviderStore((s) => s.refresh);

  const [draft, setDraft] = useState("");
  const [unleashedArmed, setUnleashedArmed] = useState(false);

  useEffect(() => {
    void detect();
    void refreshProviders();
    const prefs = usePrefsStore.getState();
    setMode(prefs.defaultMode);
    setProviderId(prefs.defaultProviderId);
  }, [detect, refreshProviders, setMode, setProviderId]);

  const backendInfo = backends.find((b) => b.backend === backend);
  const backendReady = backend === "fixture" || Boolean(backendInfo?.installed);
  const filteredProviders = useMemo(
    () => providers.filter((p) => providerCompatible(backend, p.kind)),
    [providers, backend],
  );

  const running = session?.status === "running" || session?.status === "busy";
  const crashed = session?.status === "crashed";
  const canSend = session?.status === "running" && !busy;
  const isFixture = backend === "fixture";

  const statusLabel = detecting
    ? t("agent.detecting")
    : session?.status === "busy"
      ? t("agent.statusBusy")
      : session?.status === "running"
        ? t("agent.statusLive")
        : crashed
          ? t("agent.statusCrashed")
          : isFixture
            ? t("agent.fixtureShort")
            : backendReady
              ? t("agent.ready")
              : t("agent.missing");

  const sessionLabel =
    session?.agentName ??
    (session?.acpSessionId ? session.acpSessionId.slice(0, 8) : t("agent.newAgent"));

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const value = draft.trim();
    if (!value || !canSend) return;
    setDraft("");
    void prompt(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const startSession = () => {
    if (!current || busy || running) return;
    if (mode === "unleashed" && !unleashedArmed) {
      setUnleashedArmed(true);
      return;
    }
    setUnleashedArmed(false);
    void start(current.path);
  };

  const onBackendChange = (value: StartableBackend) => {
    setBackend(value);
    if (providerId) {
      const provider = providers.find((p) => p.id === providerId);
      if (provider && !providerCompatible(value, provider.kind)) {
        setProviderId(null);
      }
    }
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? AGENT_WIDTH : 0 }}
      transition={{ type: "spring", stiffness: 480, damping: 44 }}
      className="relative shrink-0 overflow-hidden border-l border-line bg-panel"
    >
      <div className="relative flex h-full flex-col" style={{ width: AGENT_WIDTH }}>
        <header className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
          <button
            type="button"
            className="min-w-0 truncate rounded-md px-2 py-1 text-[11px] font-medium text-ink"
          >
            {sessionLabel}
          </button>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] ${
              session?.status === "running" || session?.status === "busy"
                ? "bg-accent/15 text-accent"
                : crashed
                  ? "bg-danger/15 text-danger"
                  : "bg-hover text-ink-3"
            }`}
          >
            {statusLabel}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            title={t("agent.detect")}
            onClick={() => void detect()}
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <RefreshCw className={`size-3.5 ${detecting ? "animate-spin" : ""}`} strokeWidth={1.6} />
          </button>
          {!running && !crashed ? (
            <button
              type="button"
              disabled={!current || busy || !backendReady}
              onClick={startSession}
              title={t("agent.start")}
              className="rounded p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-30"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" strokeWidth={1.6} />
              )}
            </button>
          ) : crashed ? (
            <button
              type="button"
              disabled={!current || busy}
              onClick={() => void restart()}
              className="px-1.5 text-[11px] text-accent hover:text-ink"
            >
              {t("agent.restart")}
            </button>
          ) : (
            <>
              {busy && (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  title={t("agent.cancel")}
                  className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <Square className="size-3 fill-current" strokeWidth={1.6} />
                </button>
              )}
              <button
                type="button"
                onClick={() => void stop()}
                className="px-1.5 text-[11px] text-ink-3 hover:text-ink-2"
              >
                {t("agent.stop")}
              </button>
            </>
          )}
          <button
            type="button"
            title={t("agent.toggleHide")}
            onClick={() => setAgentOpen(false)}
            className="rounded p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
          >
            <PanelRightClose className="size-3.5" strokeWidth={1.6} />
          </button>
        </header>

        {mode === "unleashed" && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-danger/90">
            <span>{t("agent.modeUnleashedWarn")}</span>
            {unleashedArmed && !running && (
              <button
                type="button"
                onClick={startSession}
                className="shrink-0 text-ink-2 underline hover:text-ink"
              >
                {t("agent.confirmUnleashed")}
              </button>
            )}
          </div>
        )}

        {isFixture && !running && (
          <div className="px-3 py-1.5 text-[11px] text-ink-3">{t("agent.fixtureHint")}</div>
        )}

        {!backendReady && backendInfo && (
          <div className="flex items-start justify-between gap-2 px-3 py-1.5 text-[11px] text-danger/90">
            <span className="min-w-0">{backendInfo.detail}</span>
            <button
              type="button"
              onClick={openSettings}
              className="shrink-0 text-ink-2 underline hover:text-ink"
            >
              {t("agent.openSetup")}
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-1.5 text-[11px] text-danger">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={clearError} className="shrink-0 text-ink-3 hover:text-ink">
              <X className="size-3" />
            </button>
          </div>
        )}

        {crashed && stderrTail.length > 0 && (
          <pre className="max-h-24 overflow-auto border-b border-line bg-app/40 px-3 py-1.5 font-mono text-[10px] leading-relaxed text-ink-3">
            {stderrTail.join("\n")}
          </pre>
        )}

        <div className="min-h-0 flex-1">
          {items.length === 0 ? (
            <div className="flex h-full flex-col px-4 pt-5">
              <p className="text-[12px] leading-relaxed text-ink-3">
                {!current
                  ? t("agent.needProject")
                  : !backendReady
                    ? t("agent.needInstall")
                    : t("agent.emptyBody")}
              </p>
              <ul className="mt-5 space-y-2 border-t border-line pt-4 text-[11px] text-ink-3">
                <li className="flex justify-between gap-3">
                  <span>{t("agent.hintStart")}</span>
                  <kbd className="font-mono text-[10px]">+</kbd>
                </li>
                <li className="flex justify-between gap-3">
                  <span>{t("agent.hintMode")}</span>
                  <span className="text-ink-2">∞ Agent</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span>{t("agent.hintProvider")}</span>
                  <span className="text-ink-2">{t("settings.nav.models")}</span>
                </li>
              </ul>
            </div>
          ) : (
            <MessageList items={items} />
          )}
        </div>

        <form onSubmit={submit} className="shrink-0 px-3 pb-3 pt-1">
          <div className="rounded-2xl border border-line bg-raised shadow-[0_1px_0_rgba(0,0,0,0.02)] focus-within:border-line-strong">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={!canSend}
              rows={3}
              placeholder={
                running ? t("agent.promptPlaceholder") : t("agent.promptNeedSession")
              }
              className="max-h-40 min-h-[4.5rem] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
            />
            <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
              <select
                value={mode}
                onChange={(event) => {
                  setUnleashedArmed(false);
                  setMode(event.target.value as AgentPermissionMode);
                }}
                disabled={running}
                className={pillSelect}
                title={t("agent.modeStandard")}
              >
                <option value="safe">{t("agent.modeSafeShort")}</option>
                <option value="standard">∞ {t("agent.modeStandardShort")}</option>
                <option value="unleashed">{t("agent.modeUnleashedShort")}</option>
              </select>
              <select
                value={backend}
                onChange={(event) => onBackendChange(event.target.value as StartableBackend)}
                disabled={running}
                className={pillSelect}
                title={backendInfo?.detail}
              >
                {backends
                  .filter((b) => b.backend !== "custom-agent")
                  .map((b) => (
                    <option key={b.backend} value={b.backend}>
                      {b.backend === "fixture"
                        ? t("agent.fixtureShort")
                        : b.backend === "codex-acp"
                          ? "Codex"
                          : b.backend === "claude-acp"
                            ? "Claude"
                            : b.backend === "pi-agent"
                              ? "Pi"
                              : b.backend}
                      {b.installed ? "" : ` (${t("agent.missing")})`}
                    </option>
                  ))}
              </select>
              <select
                value={providerId ?? ""}
                onChange={(event) => setProviderId(event.target.value || null)}
                disabled={running}
                className={`${pillSelect} min-w-0 flex-1`}
                title={t("agent.providerHint")}
              >
                <option value="">{t("agent.providerNoneShort")}</option>
                {filteredProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                    {provider.hasSecret ? "" : ` · ${t("settings.secretMissing")}`}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!canSend || !draft.trim()}
                className="ml-auto grid size-7 place-items-center rounded-full bg-ink text-[var(--bg-raised)] transition-opacity disabled:opacity-25"
                title={t("agent.send")}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="size-3.5" strokeWidth={1.8} />
                )}
              </button>
            </div>
          </div>
        </form>

        {permission && (
          <PermissionModal prompt={permission} onRespond={respondPermission} />
        )}
      </div>
    </motion.aside>
  );
}
