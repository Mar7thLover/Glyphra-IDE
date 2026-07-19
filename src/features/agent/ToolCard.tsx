import { Circle, Loader2, X } from "lucide-react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type ToolItem = Extract<AgentTimelineItem, { kind: "tool" }>;

function StatusMark({ status }: { status: string }) {
  if (status === "completed") return <span className="text-[10px] text-ink-3">done</span>;
  if (status === "failed") return <X className="size-3 text-danger" strokeWidth={1.6} />;
  if (status === "in_progress") return <Loader2 className="size-3 animate-spin text-ink-3" />;
  return <Circle className="size-2.5 text-ink-3" strokeWidth={1.5} />;
}

export default function ToolCard({ item }: { item: ToolItem }) {
  return (
    <div className="flex w-full items-center gap-2 py-1 text-left">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-ink-2">{item.title}</div>
        {(item.detail || item.toolKind) && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
            {[item.toolKind, item.detail].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <StatusMark status={item.status} />
    </div>
  );
}
