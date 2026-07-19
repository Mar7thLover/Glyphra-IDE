import { ArrowUpRight, Loader2, Plus, PanelRightClose } from "lucide-react";
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

export const AGENT_WIDTH = 380;

const pillSelect =
  "h-6 max-w-[9rem] cursor-pointer appearance-none truncate rounded-full border border-line bg-raised/80 px-2.5 text-[11px] text-ink-2 outline-none hover:border-line-strong hover:text-ink disabled:opacity-40";

/**
 * Right-hand Agent workspace — input-first, Cursor-like composer.
 */
export default function AgentWorkspace() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.agentOpen);
  const setAgentOpen = useUiStore((s) => s.setAgentOpen);

  const current = useProjectStore((s) => s.current);
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
    void start(backend, current.path);
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
            className="rounded-md px-2 py-1 text-[11px] font-medium text-ink"
          >
            {sessionLabel}
          </button>
          <div className="flex-1" />
          {!running ? (
            <button
              type="button"
              disabled={!current || busy}
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
          ) : (
            <button
              type="button"
              onClick={() => void stop()}
              className="px-1.5 text-[11px] text-ink-3 hover:text-ink-2"
            >
              {t("agent.stop")}
            </button>
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
          <div className="px-3 py-1.5 text-[11px] text-danger/90">{t("agent.modeUnleashedWarn")}</div>
        )}
        {error && <div className="px-3 py-1.5 text-[11px] text-danger">{error}</div>}

        <div className="min-h-0 flex-1">
          {items.length === 0 ? (
            <div className="flex h-full flex-col px-4 pt-5">
              <p className="text-[12px] leading-relaxed text-ink-3">
                {current ? t("agent.emptyBody") : t("agent.needProject")}
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
                  <span>{t("agent.hintToggle")}</span>
                  <kbd className="font-mono text-[10px]">Ctrl+J</kbd>
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
                onChange={(event) => setMode(event.target.value as AgentPermissionMode)}
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
                onChange={(event) => setBackend(event.target.value as StartableBackend)}
                disabled={running}
                className={pillSelect}
              >
                <option value="fixture">{t("agent.fixtureShort")}</option>
                <option value="codex-acp">Codex</option>
                <option value="claude-acp">Claude</option>
                <option value="pi-agent">Pi</option>
              </select>
              <select
                value={providerId ?? ""}
                onChange={(event) => setProviderId(event.target.value || null)}
                disabled={running}
                className={`${pillSelect} min-w-0 flex-1`}
              >
                <option value="">{t("agent.providerNoneShort")}</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
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
