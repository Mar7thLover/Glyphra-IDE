import { ListTodo } from "lucide-react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type PlanItem = Extract<AgentTimelineItem, { kind: "plan" }>;

export default function PlanCard({ item }: { item: PlanItem }) {
  return (
    <div className="rounded-lg border border-line bg-raised/50 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        <ListTodo className="size-3.5" />
        Plan
      </div>
      <ol className="space-y-1">
        {item.entries.map((entry, index) => (
          <li key={`${entry.content}-${index}`} className="flex gap-2 text-xs text-ink-2">
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-accent/70" />
            <span className="min-w-0 flex-1">{entry.content}</span>
            <span className="shrink-0 text-[10px] uppercase text-ink-3">{entry.status}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
