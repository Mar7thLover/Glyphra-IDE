import { CheckCircle2, CircleDashed, FileCode2, Loader2, XCircle } from "lucide-react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type ToolItem = Extract<AgentTimelineItem, { kind: "tool" }>;

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  if (status === "failed") return <XCircle className="size-3.5 text-danger" />;
  if (status === "in_progress") return <Loader2 className="size-3.5 animate-spin text-ink-2" />;
  return <CircleDashed className="size-3.5 text-ink-3" />;
}

export default function ToolCard({ item }: { item: ToolItem }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-raised/70 px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-raised"
    >
      <FileCode2 className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-ink">{item.title}</div>
        {(item.detail || item.toolKind) && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
            {[item.toolKind, item.detail].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <StatusIcon status={item.status} />
    </button>
  );
}
