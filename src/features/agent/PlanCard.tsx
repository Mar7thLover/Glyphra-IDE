import { CheckCircle2, Circle, CircleDot, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentTimelineItem } from "@/lib/acp/types";

type PlanItem = Extract<AgentTimelineItem, { kind: "plan" }>;

function EntryMark({ status }: { status: string }) {
  if (status === "completed")
    return <CheckCircle2 className="mt-px size-3.5 shrink-0 text-ok" strokeWidth={1.8} />;
  if (status === "in_progress")
    return <CircleDot className="mt-px size-3.5 shrink-0 animate-pulse text-accent" strokeWidth={1.8} />;
  return <Circle className="mt-px size-3.5 shrink-0 text-ink-3/50" strokeWidth={1.6} />;
}

export default function PlanCard({ item }: { item: PlanItem }) {
  const { t } = useTranslation();
  const done = item.entries.filter((entry) => entry.status === "completed").length;
  const total = item.entries.length;
  const progress = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="rounded-lg border border-line bg-raised/35 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <ListChecks className="size-3 shrink-0 text-ink-3" strokeWidth={1.8} />
        <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-ink-3">
          {t("agent.planTitle")}
        </span>
        <div className="mx-1 h-px flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-ink-3">
          {done}/{total}
        </span>
      </div>
      <ol className="space-y-1">
        {item.entries.map((entry, index) => (
          <li key={`${entry.content}-${index}`} className="flex gap-2 text-[11.5px]">
            <EntryMark status={entry.status} />
            <span
              className={`min-w-0 flex-1 leading-relaxed ${
                entry.status === "completed"
                  ? "text-ink-3 line-through decoration-line-strong"
                  : entry.status === "in_progress"
                    ? "font-medium text-ink"
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
