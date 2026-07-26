import { Brain, ChevronRight } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentTimelineItem } from "@/lib/acp/types";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown"));
type ThoughtItem = Extract<AgentTimelineItem, { kind: "thought" }>;

/** Last sentence-ish fragment — what the model is chewing on right now. */
function tailOf(text: string): string {
  const flat = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/[#*`>_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 120 ? `…${flat.slice(-120)}` : flat;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function ThoughtCard({
  item,
  live = false,
}: {
  item: ThoughtItem;
  live?: boolean;
}) {
  const { t } = useTranslation();
  // `null` follows the stream: open while thinking, closed once it lands.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? live;

  const tailRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!live) return;
    settled.current = null;
    const tick = () => setElapsed(Date.now() - item.at);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [live, item.at]);

  useEffect(() => {
    if (live || settled.current !== null) return;
    settled.current = Date.now() - item.at;
    setElapsed(settled.current);
  }, [live, item.at]);

  // Keep the newest reasoning in view while it streams.
  useEffect(() => {
    if (!live || !expanded) return;
    const node = tailRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [item.text, live, expanded]);

  const duration = elapsed >= 1000 ? formatDuration(elapsed) : null;

  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors ${
        live ? "border-line-strong/60 bg-raised/45" : "border-line/70 bg-raised/20"
      }`}
    >
      <button
        type="button"
        onClick={() => setOverride(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <Brain
          className={`size-3.5 shrink-0 ${live ? "text-ink-2" : "text-ink-3"}`}
          strokeWidth={1.5}
        />
        <span
          className={`shrink-0 text-[10.5px] font-medium ${
            live ? "thought-live" : "text-ink-3"
          }`}
        >
          {live ? t("agent.thinkingLive") : t("agent.thinking")}
        </span>
        {duration && (
          <span className="shrink-0 font-mono text-[9.5px] text-ink-3/70">{duration}</span>
        )}
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-ink-3/70">
            {tailOf(item.text)}
          </span>
        )}
        <ChevronRight
          className={`ml-auto size-3 shrink-0 text-ink-3 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>
      {expanded ? (
        <div
          ref={tailRef}
          className={`border-t border-line/70 px-2.5 py-2 ${
            live ? "thought-tail max-h-44 overflow-y-auto" : "max-h-[420px] overflow-y-auto"
          }`}
        >
          <Suspense
            fallback={
              <div className="agent-md agent-md-quiet whitespace-pre-wrap">{item.text}</div>
            }
          >
            <AssistantMarkdown text={item.text} tone="quiet" />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
