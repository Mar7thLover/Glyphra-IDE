import {
  Check,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Pencil,
  Search,
  TerminalSquare,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type ToolItem = Extract<AgentTimelineItem, { kind: "tool" }>;

const kindIcons: Record<string, LucideIcon> = {
  edit: Pencil,
  terminal: TerminalSquare,
  execute: TerminalSquare,
  read: FileText,
  fetch: Search,
  search: Search,
};

function StatusMark({ status }: { status: string }) {
  if (status === "completed") return <Check className="size-3 text-ok" strokeWidth={2.2} />;
  if (status === "failed") return <X className="size-3 text-danger" strokeWidth={2} />;
  if (status === "in_progress") return <Loader2 className="size-3 animate-spin text-accent" />;
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
  const KindIcon = kindIcons[item.toolKind ?? ""] ?? Wrench;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised/35 transition-colors hover:border-line-strong/70">
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left disabled:cursor-default"
      >
        <KindIcon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.6} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-ink-2">{item.title}</div>
          {!expanded && (item.detail || item.toolKind) && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
              {[item.toolKind, item.detail].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <StatusMark status={item.status} />
        {collapsible && (
          <ChevronRight
            className={`size-3 shrink-0 text-ink-3 transition-transform duration-150 ${
              expanded ? "rotate-90" : ""
            }`}
            strokeWidth={1.6}
          />
        )}
      </button>
      {expanded && hasDetail && (
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words border-t border-line bg-app/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink-3">
          {item.detail}
        </pre>
      )}
    </div>
  );
}
