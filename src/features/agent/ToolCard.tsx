import { CheckCircle2, CircleDashed, Loader2, Wrench, XCircle } from "lucide-react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type ToolItem = Extract<AgentTimelineItem, { kind: "tool" }>;

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-accent" />;
  if (status === "failed") return <XCircle className="size-3.5 text-danger" />;
  if (status === "in_progress") return <Loader2 className="size-3.5 animate-spin text-ink-2" />;
  return <CircleDashed className="size-3.5 text-ink-3" />;
}

export default function ToolCard({ item }: { item: ToolItem }) {
  return (
    <div className="rounded-lg border border-line bg-raised/50 px-2.5 py-2">
      <div className="flex items-center gap-2 text-xs text-ink">
        <Wrench className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
        <StatusIcon status={item.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-ink-3">
        {item.toolKind && <span className="uppercase tracking-wide">{item.toolKind}</span>}
        <span>{item.status}</span>
      </div>
      {item.detail && (
        <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-2">
          {item.detail}
        </pre>
      )}
    </div>
  );
}
