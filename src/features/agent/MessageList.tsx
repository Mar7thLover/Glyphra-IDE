import { lazy, Suspense } from "react";
import { Virtuoso } from "react-virtuoso";

import type { AgentTimelineItem } from "@/lib/acp/types";

import PlanCard from "./PlanCard";
import ToolCard from "./ToolCard";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown"));

function TimelineRow({ item }: { item: AgentTimelineItem }) {
  if (item.kind === "tool") return <div className="px-2 py-1.5"><ToolCard item={item} /></div>;
  if (item.kind === "plan") return <div className="px-2 py-1.5"><PlanCard item={item} /></div>;

  if (item.kind === "assistant") {
    return (
      <div className="px-2 py-1.5 text-xs">
        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-3">assistant</div>
        <Suspense fallback={<div className="whitespace-pre-wrap text-ink-2">{item.text}</div>}>
          <AssistantMarkdown text={item.text} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="px-2 py-1.5 text-xs">
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-3">{item.kind}</div>
      <div className="whitespace-pre-wrap text-ink-2">{item.text}</div>
    </div>
  );
}

export default function MessageList({ items }: { items: AgentTimelineItem[] }) {
  return (
    <Virtuoso
      className="h-full"
      data={items}
      followOutput="smooth"
      itemContent={(_, item) => <TimelineRow item={item} />}
    />
  );
}
