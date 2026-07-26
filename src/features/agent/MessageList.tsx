import {
  ArrowDown,
  CheckCheck,
  Copy,
  History,
  Languages,
  MessageSquareQuote,
  Pencil,
  Quote,
  RefreshCw,
} from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { copyText } from "@/lib/clipboard";
import { imageDataUrl } from "@/lib/agentImages";
import type { AgentTimelineItem } from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { focusAgentComposer, useComposerDraft } from "@/lib/stores/composerStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";

import PlanCard from "./PlanCard";
import ReviewCommentCard, { parseReviewComments } from "./ReviewCommentCard";
import SystemNote from "./SystemNote";
import ToolCard from "./ToolCard";
import ThoughtCard from "./ThoughtCard";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown"));

/** A timeline entry, or a run of system notes folded into one seam. */
export type TimelineRowData =
  | { key: string; kind: "item"; item: AgentTimelineItem }
  | { key: string; kind: "system"; tone: "config" | "alert"; texts: string[] };

/**
 * Session bookkeeping — connected, authenticated, turn complete — is noise the
 * composer pills and status chip already carry. Only a switch the user made
 * (`config`) or a real failure (`alert`) earns a row; consecutive ones fold.
 */
export function buildRows(items: AgentTimelineItem[]): TimelineRowData[] {
  const rows: TimelineRowData[] = [];
  for (const item of items) {
    if (item.kind === "system") {
      if (!item.note) continue;
      const last = rows.at(-1);
      if (last?.kind === "system" && last.tone === item.note) {
        last.texts = [...last.texts, item.text];
        continue;
      }
      rows.push({ key: item.id, kind: "system", tone: item.note, texts: [item.text] });
      continue;
    }
    rows.push({ key: item.id, kind: "item", item });
  }
  return rows;
}

function HoverAction({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded p-1 transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 ${
        tone === "danger" ? "text-danger" : "text-ink-3"
      }`}
    >
      {children}
    </button>
  );
}

function AssistantMessage({ item }: { item: Extract<AgentTimelineItem, { kind: "assistant" }> }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const comments = useMemo(() => parseReviewComments(item.text), [item.text]);

  const copy = () => {
    void copyText(item.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="group/msg relative px-3.5 pb-1 pt-1.5">
      <Suspense
        fallback={<div className="agent-md whitespace-pre-wrap text-ink-2">{item.text}</div>}
      >
        <AssistantMarkdown text={item.text} />
      </Suspense>
      <ReviewCommentCard comments={comments} />
      <div className="mt-0.5 flex h-5 items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
        <HoverAction label={t("agent.copyMessage")} onClick={copy}>
          {copied ? (
            <CheckCheck className="size-3 text-ok" strokeWidth={2} />
          ) : (
            <Copy className="size-3" />
          )}
        </HoverAction>
        <HoverAction
          label={t("agent.quoteMessage")}
          onClick={() => {
            useComposerDraft.getState().addReference({
              kind: "selection",
              label: item.text.replace(/\s+/g, " ").trim().slice(0, 36),
              content: item.text,
            });
            focusAgentComposer();
          }}
        >
          <Quote className="size-3" />
        </HoverAction>
      </div>
    </div>
  );
}

function UserMessage({
  item,
  busy,
  failed,
  projectPath,
}: {
  item: Extract<AgentTimelineItem, { kind: "user" }>;
  busy: boolean;
  failed: boolean;
  projectPath: string | null;
}) {
  const { t } = useTranslation();

  const editMessage = () => {
    const composer = useComposerDraft.getState();
    composer.setDraft(item.text);
    composer.setReferences([]);
    composer.setImages(item.images ?? []);
    focusAgentComposer();
  };
  const resendMessage = () => {
    if (busy) return;
    void useAgentStore
      .getState()
      .prompt(item.promptText ?? item.text, item.text, item.images ?? []);
  };
  const restoreCheckpoint = () => {
    if (!projectPath || !item.checkpointId) return;
    if (!window.confirm(t("agent.restoreCheckpointConfirm"))) return;
    void useReviewStore.getState().restoreBeforeTurn(projectPath, item.checkpointId);
  };

  return (
    <div className="group/user flex justify-end px-3.5 pb-1 pt-3">
      <div className="flex min-w-0 max-w-[85%] flex-col items-end">
        <div
          className={`w-fit min-w-0 rounded-2xl rounded-br-[6px] border px-3 py-1.5 text-[12.5px] leading-relaxed text-ink ${
            failed ? "border-danger/30 bg-danger/[0.05]" : "border-line bg-accent-soft"
          }`}
        >
          <div className="whitespace-pre-wrap break-words">{item.text}</div>
          {item.images && item.images.length > 0 && (
            <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
              {item.images.map((image) => (
                <img
                  key={image.id}
                  src={imageDataUrl(image)}
                  alt={image.name}
                  title={image.name}
                  className="max-h-40 max-w-52 rounded-lg border border-line object-contain"
                />
              ))}
            </div>
          )}
        </div>
        <div className="mt-0.5 flex h-5 items-center gap-0.5">
          {item.checkpointId && (
            <button
              type="button"
              disabled={busy || !projectPath}
              onClick={restoreCheckpoint}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9.5px] text-ink-3 opacity-0 transition-opacity hover:bg-hover hover:text-ink disabled:opacity-0 group-hover/user:opacity-100 group-focus-within/user:opacity-100"
              title={t("agent.restoreCheckpointHint")}
            >
              <History className="size-2.5" />
              {t("agent.checkpointAnchor")}
            </button>
          )}
          <span
            className={`flex items-center gap-0.5 transition-opacity group-hover/user:opacity-100 group-focus-within/user:opacity-100 ${
              failed ? "opacity-100" : "opacity-0"
            }`}
          >
            <HoverAction label={t("agent.editMessage")} onClick={editMessage}>
              <Pencil className="size-3" />
            </HoverAction>
            <HoverAction
              label={failed ? t("agent.retryFailedTurn") : t("agent.resendMessage")}
              onClick={resendMessage}
              disabled={busy}
              tone={failed ? "danger" : undefined}
            >
              <RefreshCw className="size-3" />
            </HoverAction>
          </span>
        </div>
      </div>
    </div>
  );
}

function TimelineRow({
  row,
  busy,
  failed,
  liveThought,
  projectPath,
}: {
  row: TimelineRowData;
  busy: boolean;
  failed: boolean;
  liveThought: boolean;
  projectPath: string | null;
}) {
  if (row.kind === "system") return <SystemNote tone={row.tone} texts={row.texts} />;

  const { item } = row;
  if (item.kind === "tool") {
    return (
      <div className="px-3.5 py-0.5">
        <ToolCard item={item} />
      </div>
    );
  }
  if (item.kind === "plan") {
    return (
      <div className="px-3.5 py-1">
        <PlanCard item={item} />
      </div>
    );
  }
  if (item.kind === "thought") {
    return (
      <div className="px-3.5 py-0.5">
        <ThoughtCard item={item} live={liveThought} />
      </div>
    );
  }
  if (item.kind === "user") {
    return <UserMessage item={item} busy={busy} failed={failed} projectPath={projectPath} />;
  }
  if (item.kind === "assistant") return <AssistantMessage item={item} />;
  return null;
}

export default function MessageList({ items }: { items: AgentTimelineItem[] }) {
  const { t } = useTranslation();
  const busy = useAgentStore((state) => state.busy);
  const error = useAgentStore((state) => state.error);
  const projectPath = useProjectStore((state) => state.current?.path ?? null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [selectionMenu, setSelectionMenu] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const rows = useMemo(() => buildRows(items), [items]);

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
  const lastUserId = [...items].reverse().find((item) => item.kind === "user")?.id;
  const lastItemId = items.at(-1)?.id;

  return (
    <div
      ref={rootRef}
      className="agent-selectable relative h-full min-h-0"
      onContextMenu={(event) => {
        const selection = window.getSelection();
        const ancestor = selection?.rangeCount
          ? selection.getRangeAt(0).commonAncestorContainer
          : null;
        if (
          !selection ||
          selection.isCollapsed ||
          !ancestor ||
          !rootRef.current?.contains(ancestor)
        )
          return;
        const text = selection.toString().trim();
        if (!text) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectionMenu({ text, x: event.clientX, y: event.clientY });
      }}
    >
      <Virtuoso
        ref={listRef}
        className="h-full"
        data={rows}
        followOutput="smooth"
        atBottomThreshold={72}
        atBottomStateChange={setAtBottom}
        increaseViewportBy={{ top: 240, bottom: 480 }}
        computeItemKey={(_, row) => row.key}
        itemContent={(_, row) => (
          <TimelineRow
            row={row}
            busy={busy}
            failed={Boolean(
              error && row.kind === "item" && row.item.kind === "user" && row.item.id === lastUserId,
            )}
            liveThought={busy && row.kind === "item" && row.item.id === lastItemId}
            projectPath={projectPath}
          />
        )}
      />
      {!atBottom && (
        <button
          type="button"
          onClick={() => listRef.current?.scrollToIndex({ index: "LAST", behavior: "smooth" })}
          title={t("agent.jumpToLatest")}
          aria-label={t("agent.jumpToLatest")}
          className="glass-float pop-in absolute bottom-3 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowDown className="size-3.5" strokeWidth={2} />
        </button>
      )}
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
