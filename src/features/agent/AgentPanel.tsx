import { Bot, Loader2, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";

import type { AgentBackendKind } from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useProjectStore } from "@/lib/stores/projectStore";

type StartableBackend = AgentBackendKind | "fixture";

export default function AgentPanel() {
  const { t } = useTranslation();
  const current = useProjectStore((s) => s.current);
  const backends = useAgentStore((s) => s.backends);
  const detecting = useAgentStore((s) => s.detecting);
  const session = useAgentStore((s) => s.session);
  const messages = useAgentStore((s) => s.messages);
  const busy = useAgentStore((s) => s.busy);
  const error = useAgentStore((s) => s.error);
  const detect = useAgentStore((s) => s.detect);
  const start = useAgentStore((s) => s.start);
  const prompt = useAgentStore((s) => s.prompt);
  const stop = useAgentStore((s) => s.stop);
  const [draft, setDraft] = useState("");
  const [backend, setBackend] = useState<StartableBackend>("fixture");

  useEffect(() => {
    void detect();
  }, [detect]);

  const running = session?.status === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line px-3 pb-3">
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <Bot className="size-3.5" strokeWidth={1.7} />
          {t("agent.subtitle")}
        </div>
        <select
          value={backend}
          onChange={(event) => setBackend(event.target.value as StartableBackend)}
          disabled={running}
          className="w-full rounded-lg border border-line bg-raised px-2 py-1.5 text-xs text-ink"
        >
          <option value="fixture">{t("agent.fixture")}</option>
          <option value="codex-acp">Codex ACP</option>
          <option value="claude-acp">Claude ACP</option>
          <option value="pi-agent">Pi Agent</option>
          <option value="custom-agent">Custom</option>
        </select>
        <div className="flex gap-2">
          {!running ? (
            <button
              disabled={!current || busy}
              onClick={() => current && void start(backend, current.path)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t("agent.start")}
            </button>
          ) : (
            <button
              onClick={() => void stop()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1.5 text-xs text-ink-2"
            >
              <Square className="size-3.5" />
              {t("agent.stop")}
            </button>
          )}
          <button
            onClick={() => void detect()}
            className="rounded-lg border border-line px-2 py-1.5 text-xs text-ink-2 hover:bg-hover"
          >
            {detecting ? <Loader2 className="size-3.5 animate-spin" /> : t("agent.detect")}
          </button>
        </div>
        {!current && <p className="text-[11px] text-ink-3">{t("agent.needProject")}</p>}
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 px-1">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col gap-2 overflow-auto px-2 py-3 text-[11px] text-ink-3">
            {backends.map((item) => (
              <div key={item.backend} className="rounded-lg border border-line bg-raised/40 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-2">{item.backend}</span>
                  <span className={item.installed ? "text-accent" : "text-ink-3"}>
                    {item.installed ? t("agent.installed") : t("agent.missing")}
                  </span>
                </div>
                <div className="mt-0.5 truncate">{item.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          <Virtuoso
            className="h-full"
            data={messages}
            followOutput="smooth"
            itemContent={(_, message) => (
              <div className="px-2 py-1.5 text-xs">
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-3">{message.role}</div>
                <div className="whitespace-pre-wrap text-ink-2">{message.text}</div>
              </div>
            )}
          />
        )}
      </div>

      <form
        className="flex gap-2 border-t border-line p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft;
          setDraft("");
          void prompt(value);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!running || busy}
          placeholder={t("agent.promptPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!running || busy || !draft.trim()}
          className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-40"
        >
          {t("agent.send")}
        </button>
      </form>
    </div>
  );
}
