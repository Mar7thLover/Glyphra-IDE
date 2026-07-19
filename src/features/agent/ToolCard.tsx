import { ChevronDown, ChevronRight, Circle, Loader2, X } from "lucide-react";
import { useState } from "react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type ToolItem = Extract<AgentTimelineItem, { kind: "tool" }>;

function StatusMark({ status }: { status: string }) {
  if (status === "completed") return <span className="text-[10px] text-ink-3">done</span>;
  if (status === "failed") return <X className="size-3 text-danger" strokeWidth={1.6} />;
  if (status === "in_progress") return <Loader2 className="size-3 animate-spin text-ink-3" />;
  return <Circle className="size-2.5 text-ink-3" strokeWidth={1.5} />;
}

export default function ToolCard({ item }: { item: ToolItem }) {
  const hasDetail = Boolean(item.detail && item.detail.trim());
  const collapsible =
    hasDetail &&
    (item.toolKind === "edit" ||
      item.toolKind === "terminal" ||
      item.toolKind === "execute" ||
      (item.detail?.includes("\n") ?? false));
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full py-1 text-left">
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 disabled:cursor-default"
      >
        {collapsible ? (
          expanded ? (
            <ChevronDown className="size-3 shrink-0 text-ink-3" strokeWidth={1.6} />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-ink-3" strokeWidth={1.6} />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-ink-2">{item.title}</div>
          {!expanded && (item.detail || item.toolKind) && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
              {[item.toolKind, item.detail].filter(Boolean).join(" · ")}
            </div>
          )}
          {!hasDetail && item.toolKind && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">{item.toolKind}</div>
          )}
        </div>
        <StatusMark status={item.status} />
      </button>
      {expanded && hasDetail && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-app/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-ink-3">
          {item.detail}
        </pre>
      )}
    </div>
  );
}
