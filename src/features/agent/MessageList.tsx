import { CheckCheck, Copy, Languages, MessageSquareQuote, Quote } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { copyText } from "@/lib/clipboard";
import type { AgentTimelineItem } from "@/lib/acp/types";
import { focusAgentComposer, useComposerDraft } from "@/lib/stores/composerStore";

import PlanCard from "./PlanCard";
import ToolCard from "./ToolCard";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown"));

function TimelineRow({ item }: { item: AgentTimelineItem }) {
  if (item.kind === "tool") {
    return (
      <div className="px-3 py-0.5">
        <ToolCard item={item} />
      </div>
    );
  }
  if (item.kind === "plan") {
    return (
      <div className="px-3 py-1">
        <PlanCard item={item} />
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="px-3 py-2">
        <div className="ml-7 rounded-xl rounded-tr-[4px] border border-accent/12 bg-accent-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          <div className="whitespace-pre-wrap">{item.text}</div>
        </div>
      </div>
    );
  }

  if (item.kind === "assistant") {
    return (
      <div className="px-3.5 py-2">
        <div className="text-[12.5px] leading-relaxed text-ink">
          <Suspense fallback={<div className="whitespace-pre-wrap text-ink-2">{item.text}</div>}>
            <AssistantMarkdown text={item.text} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3.5 py-1">
      <div className="text-[11px] leading-relaxed text-ink-3">{item.text}</div>
    </div>
  );
}

export default function MessageList({ items }: { items: AgentTimelineItem[] }) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const attachSelection = (text: string) => {
    const compact = text.replace(/\s+/g, " ").trim();
    useComposerDraft.getState().addReference({
      kind: "selection",
      label: compact.length > 36 ? `${compact.slice(0, 36)}…` : compact,
      content: text,
    });
    focusAgentComposer();
  };

  const queueAction = (text: string, instruction: string) => {
    attachSelection(text);
    const state = useComposerDraft.getState();
    state.setDraft(state.draft.trim() ? `${state.draft.trim()}\n${instruction}` : instruction);
    focusAgentComposer();
  };

  const menuItems: ContextMenuItem[] = selectionMenu
    ? [
        {
          id: "copy",
          label: t("agent.copySelection"),
          shortcut: "Ctrl+C",
          icon: <Copy className="size-3.5" />,
          action: () => copyText(selectionMenu.text),
        },
        {
          id: "attach",
          label: t("agent.attachSelection"),
          icon: <Quote className="size-3.5" />,
          action: () => attachSelection(selectionMenu.text),
        },
        { id: "selection-separator", separator: true },
        {
          id: "explain",
          label: t("agent.explainSelection"),
          icon: <MessageSquareQuote className="size-3.5" />,
          action: () => queueAction(selectionMenu.text, t("agent.explainSelectionPrompt")),
        },
        {
          id: "review",
          label: t("agent.reviewSelection"),
          icon: <CheckCheck className="size-3.5" />,
          action: () => queueAction(selectionMenu.text, t("agent.reviewSelectionPrompt")),
        },
        {
          id: "translate",
          label: t("agent.translateSelection"),
          icon: <Languages className="size-3.5" />,
          action: () => queueAction(selectionMenu.text, t("agent.translateSelectionPrompt")),
        },
      ]
    : [];

  return (
    <div
      ref={rootRef}
      className="agent-selectable h-full min-h-0"
      onContextMenu={(event) => {
        const selection = window.getSelection();
        const ancestor = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
        if (!selection || selection.isCollapsed || !ancestor || !rootRef.current?.contains(ancestor)) return;
        const text = selection.toString().trim();
        if (!text) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectionMenu({ text, x: event.clientX, y: event.clientY });
      }}
    >
      <Virtuoso
        className="h-full"
        data={items}
        followOutput="smooth"
        itemContent={(_, item) => <TimelineRow item={item} />}
      />
      {selectionMenu && (
        <ContextMenu
          x={selectionMenu.x}
          y={selectionMenu.y}
          items={menuItems}
          onClose={() => setSelectionMenu(null)}
        />
      )}
    </div>
  );
}
