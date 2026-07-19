import type { AgentTimelineItem } from "@/lib/acp/types";

type PlanItem = Extract<AgentTimelineItem, { kind: "plan" }>;

export default function PlanCard({ item }: { item: PlanItem }) {
  return (
    <div className="py-1">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">Plan</div>
      <ol className="space-y-1 border-l border-line pl-2.5">
        {item.entries.map((entry, index) => (
          <li key={`${entry.content}-${index}`} className="flex gap-2 text-[11px] text-ink-2">
            <span className="min-w-0 flex-1 leading-relaxed">{entry.content}</span>
            <span className="shrink-0 text-[10px] text-ink-3">{entry.status}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
