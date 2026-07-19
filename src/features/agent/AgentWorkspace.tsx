import { Loader2, PanelRightClose, SendHorizontal } from "lucide-react";
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

export const AGENT_WIDTH = 360;

const selectClass =
  "h-6 max-w-full truncate border-0 bg-transparent py-0 pr-4 text-[11px] text-ink-2 outline-none hover:text-ink disabled:opacity-40";

/**
 * Independent right-hand Agent workspace.
 * Quiet chrome — steering only; editing stays in the center IDE.
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

  const knownBackends = backends.filter((b) => b.backend !== "custom-agent").slice(0, 4);

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? AGENT_WIDTH : 0 }}
      transition={{ type: "spring", stiffness: 480, damping: 44 }}
      className="relative shrink-0 overflow-hidden border-l border-line bg-panel"
    >
      <div className="relative flex h-full flex-col" style={{ width: AGENT_WIDTH }}>
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[11px] font-medium tracking-wide text-ink-2">
                {sessionLabel}
              </span>
              {running && (
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    session?.status === "busy" ? "bg-ink-3" : "bg-accent"
                  }`}
                  title={session?.status === "busy" ? t("agent.statusBusy") : t("agent.statusLive")}
                />
              )}
            </div>
          </div>
          <button
            type="button"
            title={t("agent.toggleHide")}
            onClick={() => setAgentOpen(false)}
            className="rounded p-1 text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
          >
            <PanelRightClose className="size-3.5" strokeWidth={1.6} />
          </button>
        </header>

        <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1">
          <select
            value={backend}
            onChange={(event) => setBackend(event.target.value as StartableBackend)}
            disabled={running}
            className={`${selectClass} min-w-0 flex-[1.2]`}
            title={t("agent.fixture")}
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
            className={`${selectClass} min-w-0 flex-1`}
          >
            <option value="">{t("agent.providerNoneShort")}</option>
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
            className={`${selectClass} w-[4.5rem] shrink-0`}
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
              className="ml-0.5 shrink-0 px-1.5 text-[11px] text-ink-2 transition-colors hover:text-ink disabled:opacity-35"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : t("agent.start")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stop()}
              className="ml-0.5 shrink-0 px-1.5 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
            >
              {t("agent.stop")}
            </button>
          )}
        </div>

        {mode === "unleashed" && (
          <div className="border-b border-line px-3 py-1.5 text-[11px] text-danger/90">
            {t("agent.modeUnleashedWarn")}
          </div>
        )}
        {error && (
          <div className="border-b border-line px-3 py-1.5 text-[11px] text-danger">{error}</div>
        )}

        <div className="min-h-0 flex-1">
          {items.length === 0 ? (
            <div className="flex h-full flex-col px-4 pt-8">
              <p className="text-[12px] leading-relaxed text-ink-3">{t("agent.emptyBody")}</p>
              {!current && (
                <p className="mt-3 text-[11px] text-ink-3/80">{t("agent.needProject")}</p>
              )}
              {knownBackends.length > 0 && (
                <ul className="mt-6 space-y-1.5 border-t border-line pt-4">
                  {knownBackends.map((item) => (
                    <li
                      key={item.backend}
                      className="flex items-baseline justify-between gap-3 text-[11px]"
                    >
                      <span className="font-mono text-ink-2">{item.backend}</span>
                      <span className={item.installed ? "text-ink-2" : "text-ink-3"}>
                        {item.installed ? t("agent.installed") : t("agent.missing")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <MessageList items={items} />
          )}
        </div>

        <form onSubmit={submit} className="shrink-0 border-t border-line">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={!canSend}
            rows={2}
            placeholder={
              running ? t("agent.promptPlaceholder") : t("agent.promptNeedSession")
            }
            className="max-h-36 min-h-[3.25rem] w-full resize-none bg-transparent px-3 pt-2.5 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3/70 disabled:opacity-45"
          />
          <div className="flex items-center gap-2 px-3 pb-2">
            <span className="truncate font-mono text-[10px] text-ink-3">
              {backend}
              {providerId ? ` · ${providers.find((p) => p.id === providerId)?.name ?? ""}` : ""}
            </span>
            <div className="flex-1" />
            <button
              type="submit"
              disabled={!canSend || !draft.trim()}
              className="inline-flex items-center gap-1 text-[11px] text-ink-2 transition-colors hover:text-ink disabled:opacity-30"
              title={t("agent.send")}
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <SendHorizontal className="size-3" strokeWidth={1.7} />
              )}
              {t("agent.send")}
            </button>
          </div>
        </form>

        {permission && (
          <PermissionModal prompt={permission} onRespond={respondPermission} />
        )}
      </div>
    </motion.aside>
  );
}
