import { lazy, Suspense } from "react";
import { Virtuoso } from "react-virtuoso";

import type { AgentTimelineItem } from "@/lib/acp/types";

import PlanCard from "./PlanCard";
import ToolCard from "./ToolCard";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown"));

function TimelineRow({ item }: { item: AgentTimelineItem }) {
  if (item.kind === "tool") {
    return (
      <div className="px-4 py-1.5">
        <ToolCard item={item} />
      </div>
    );
  }
  if (item.kind === "plan") {
    return (
      <div className="px-4 py-1.5">
        <PlanCard item={item} />
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="px-4 py-2">
        <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-accent/12 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
          <div className="whitespace-pre-wrap">{item.text}</div>
        </div>
      </div>
    );
  }

  if (item.kind === "assistant") {
    return (
      <div className="px-4 py-2">
        <div className="max-w-[96%] text-[13px] leading-relaxed text-ink">
          <Suspense fallback={<div className="whitespace-pre-wrap text-ink-2">{item.text}</div>}>
            <AssistantMarkdown text={item.text} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-1">
      <div className="text-[11px] leading-relaxed text-ink-3">{item.text}</div>
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
