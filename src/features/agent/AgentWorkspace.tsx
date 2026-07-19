import { Bot, Loader2, PanelRightClose, Play, SendHorizontal, Square } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { AgentPermissionMode, StartableBackend } from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";
import { useUiStore } from "@/lib/stores/uiStore";

import MessageList from "./MessageList";
import PermissionModal from "./PermissionModal";

export const AGENT_WIDTH = 400;

/**
 * Independent right-hand Agent workspace (Cursor-style).
 * Text editing stays in the center IDE — this panel only steers the agent.
 */
export default function AgentWorkspace() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.agentOpen);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);

  const current = useProjectStore((s) => s.current);
  const backends = useAgentStore((s) => s.backends);
  const session = useAgentStore((s) => s.session);
  const items = useAgentStore((s) => s.items);
  const permission = useAgentStore((s) => s.permission);
  const busy = useAgentStore((s) => s.busy);
  const error = useAgentStore((s) => s.error);
  const mode = useAgentStore((s) => s.mode);
  const providerId = useAgentStore((s) => s.providerId);
  const detect = useAgentStore((s) => s.detect);
  const setMode = useAgentStore((s) => s.setMode);
  const setProviderId = useAgentStore((s) => s.setProviderId);
  const start = useAgentStore((s) => s.start);
  const prompt = useAgentStore((s) => s.prompt);
  const respondPermission = useAgentStore((s) => s.respondPermission);
  const stop = useAgentStore((s) => s.stop);
  const providers = useProviderStore((s) => s.providers);
  const refreshProviders = useProviderStore((s) => s.refresh);

  const [draft, setDraft] = useState("");
  const [backend, setBackend] = useState<StartableBackend>("fixture");

  useEffect(() => {
    void detect();
    void refreshProviders();
  }, [detect, refreshProviders]);

  const running = session?.status === "running" || session?.status === "busy";
  const canSend = session?.status === "running" && !busy;
  const sessionLabel =
    session?.agentName ??
    (session?.acpSessionId ? session.acpSessionId.slice(0, 8) : t("agent.idleTitle"));

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

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? AGENT_WIDTH : 0 }}
      transition={{ type: "spring", stiffness: 460, damping: 42 }}
      className="relative shrink-0 overflow-hidden border-l border-line bg-panel"
    >
      <div className="relative flex h-full flex-col" style={{ width: AGENT_WIDTH }}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <Bot className="size-3.5 text-accent" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink">{sessionLabel}</div>
          </div>
          {running && (
            <span className="rounded-full bg-accent/12 px-1.5 py-px text-[10px] font-medium text-accent">
              {session?.status === "busy" ? t("agent.statusBusy") : t("agent.statusLive")}
            </span>
          )}
          <button
            type="button"
            title={t("agent.toggleHide")}
            onClick={() => setAgentOpen(false)}
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <PanelRightClose className="size-3.5" />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
          <select
            value={backend}
            onChange={(event) => setBackend(event.target.value as StartableBackend)}
            disabled={running}
            className="h-7 max-w-[9.5rem] rounded-md border border-line bg-raised px-1.5 text-[11px] text-ink"
          >
            <option value="fixture">{t("agent.fixture")}</option>
            <option value="codex-acp">Codex</option>
            <option value="claude-acp">Claude</option>
            <option value="pi-agent">Pi</option>
          </select>
          <select
            value={providerId ?? ""}
            onChange={(event) => setProviderId(event.target.value || null)}
            disabled={running}
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-raised px-1.5 text-[11px] text-ink"
          >
            <option value="">{t("agent.providerNone")}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as AgentPermissionMode)}
            disabled={running}
            className="h-7 rounded-md border border-line bg-raised px-1.5 text-[11px] text-ink"
          >
            <option value="safe">{t("agent.modeSafeShort")}</option>
            <option value="standard">{t("agent.modeStandardShort")}</option>
            <option value="unleashed">{t("agent.modeUnleashedShort")}</option>
          </select>
          {!running ? (
            <button
              type="button"
              disabled={!current || busy}
              onClick={() => current && void start(backend, current.path)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-medium text-accent-ink disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              {t("agent.start")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stop()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-ink-2 hover:bg-hover"
            >
              <Square className="size-3" />
              {t("agent.stop")}
            </button>
          )}
        </div>

        {mode === "unleashed" && (
          <div className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger">
            {t("agent.modeUnleashedWarn")}
          </div>
        )}
        {error && (
          <div className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {items.length === 0 ? (
            <div className="flex h-full flex-col justify-center gap-4 px-5 py-6">
              <div>
                <h2 className="text-sm font-semibold text-ink">{t("agent.emptyTitle")}</h2>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{t("agent.emptyBody")}</p>
              </div>
              <div className="space-y-1.5">
                {backends
                  .filter((b) => b.backend !== "custom-agent")
                  .slice(0, 4)
                  .map((item) => (
                    <div
                      key={item.backend}
                      className="flex items-center justify-between rounded-lg border border-line bg-raised/50 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="truncate text-ink-2">{item.backend}</span>
                      <span className={item.installed ? "text-accent" : "text-ink-3"}>
                        {item.installed ? t("agent.installed") : t("agent.missing")}
                      </span>
                    </div>
                  ))}
              </div>
              {!current && <p className="text-[11px] text-ink-3">{t("agent.needProject")}</p>}
            </div>
          ) : (
            <MessageList items={items} />
          )}
        </div>

        <form onSubmit={submit} className="shrink-0 border-t border-line p-3">
          <div className="rounded-2xl border border-line bg-raised shadow-sm focus-within:border-accent/50">
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
            <div className="flex items-center gap-2 px-2.5 pb-2.5">
              <span className="rounded-md bg-panel px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
                Agent
              </span>
              <span className="truncate text-[10px] text-ink-3">
                {backend}
                {providerId ? ` · ${providers.find((p) => p.id === providerId)?.name ?? ""}` : ""}
              </span>
              <div className="flex-1" />
              <button
                type="submit"
                disabled={!canSend || !draft.trim()}
                className="grid size-8 place-items-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-35"
                title={t("agent.send")}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <SendHorizontal className="size-3.5" />
                )}
              </button>
            </div>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-ink-3">{t("agent.inputHint")}</p>
        </form>

        {permission && (
          <PermissionModal prompt={permission} onRespond={respondPermission} />
        )}
      </div>
    </motion.aside>
  );
}
