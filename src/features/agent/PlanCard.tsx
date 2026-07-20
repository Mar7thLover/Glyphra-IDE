import { CheckCircle2, Circle, CircleDot } from "lucide-react";

import type { AgentTimelineItem } from "@/lib/acp/types";

type PlanItem = Extract<AgentTimelineItem, { kind: "plan" }>;

function EntryMark({ status }: { status: string }) {
  if (status === "completed")
    return <CheckCircle2 className="mt-px size-3.5 shrink-0 text-accent" strokeWidth={1.8} />;
  if (status === "in_progress")
    return <CircleDot className="mt-px size-3.5 shrink-0 text-accent" strokeWidth={1.8} />;
  return <Circle className="mt-px size-3.5 shrink-0 text-ink-3/60" strokeWidth={1.6} />;
}

export default function PlanCard({ item }: { item: PlanItem }) {
  const done = item.entries.filter((entry) => entry.status === "completed").length;

  return (
    <div className="rounded-lg border border-line bg-raised/35 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-ink-3">Plan</span>
        <span className="font-mono text-[10px] text-ink-3">
          {done}/{item.entries.length}
        </span>
      </div>
      <ol className="space-y-1.5">
        {item.entries.map((entry, index) => (
          <li key={`${entry.content}-${index}`} className="flex gap-2 text-[11px]">
            <EntryMark status={entry.status} />
            <span
              className={`min-w-0 flex-1 leading-relaxed ${
                entry.status === "completed"
                  ? "text-ink-3 line-through decoration-line-strong"
                  : entry.status === "in_progress"
                    ? "text-ink"
                    : "text-ink-2"
              }`}
            >
              {entry.content}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
