import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Circle,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Search,
  TerminalSquare,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentTimelineItem, AgentToolContent } from "@/lib/acp/types";
import { copyText } from "@/lib/clipboard";
import { buildLineDiff } from "@/lib/lineDiff";
import { revealInEditor } from "@/lib/revealPath";

type ToolItem = Extract<AgentTimelineItem, { kind: "tool" }>;
type DiffBlock = Extract<AgentToolContent, { kind: "diff" }>;

const kindIcons: Record<string, LucideIcon> = {
  edit: Pencil,
  terminal: TerminalSquare,
  execute: TerminalSquare,
  read: FileText,
  fetch: Globe,
  search: Search,
  think: Wrench,
};

function StatusMark({ status }: { status: string }) {
  if (status === "completed") return <Check className="size-3 text-ok" strokeWidth={2.4} />;
  if (status === "failed")
    return <TriangleAlert className="size-3 text-danger" strokeWidth={2} />;
  if (status === "in_progress") return <Loader2 className="size-3 animate-spin text-accent" />;
  return <Circle className="size-2.5 text-ink-3/70" strokeWidth={1.5} />;
}

function splitPath(path: string): { dir: string; name: string } {
  const parts = path.split(/[\\/]/);
  const name = parts.pop() ?? path;
  const dir = parts.join("/");
  return { dir: dir.length > 34 ? `…${dir.slice(-34)}` : dir, name };
}

/** +N / −N for a diff, shown before it is ever expanded. */
function diffStats(block: DiffBlock): { added: number; removed: number } {
  const rows = buildLineDiff(block.oldText, block.newText);
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "remove") removed += 1;
  }
  return { added, removed };
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-[9.5px] tabular-nums">
      {added > 0 && <span className="text-ok">+{added}</span>}
      {added > 0 && removed > 0 && <span className="text-ink-3/50"> </span>}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
    </span>
  );
}

function DiffContent({ block }: { block: DiffBlock }) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildLineDiff(block.oldText, block.newText), [block]);
  const stats = useMemo(() => diffStats(block), [block]);
  const { dir, name } = splitPath(block.path);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-app/60">
      <div className="group/diff flex items-center gap-1.5 border-b border-line bg-panel/40 px-2 py-1">
        <button
          type="button"
          onClick={() => void revealInEditor(block.path)}
          title={block.path}
          className="flex min-w-0 items-baseline gap-1.5 text-left"
        >
          <span className="truncate font-mono text-[10.5px] text-ink hover:underline">{name}</span>
          {dir && <span className="truncate font-mono text-[9.5px] text-ink-3">{dir}</span>}
        </button>
        <ArrowUpRight
          className="size-2.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/diff:opacity-100"
          strokeWidth={2}
        />
        <span className="flex-1" />
        <DiffStat {...stats} />
        <button
          type="button"
          onClick={() => void copyText(block.newText)}
          title={t("agent.copyToolOutput")}
          className="rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover/diff:opacity-100"
        >
          <Copy className="size-2.5" />
        </button>
      </div>
      <div className="max-h-72 overflow-auto font-mono text-[10px] leading-[1.55]">
        {rows.map((row, index) =>
          row.kind === "hunk" ? (
            <div
              key={`hunk-${index}`}
              className="select-none border-y border-line/50 bg-panel/50 px-2 py-px text-[9.5px] text-ink-3"
            >
              {row.text}
            </div>
          ) : (
            <div
              key={`${row.kind}-${row.oldLine ?? "n"}-${row.newLine ?? "n"}-${index}`}
              className={`flex min-w-max ${
                row.kind === "add"
                  ? "bg-ok/[0.07] text-ink"
                  : row.kind === "remove"
                    ? "bg-danger/[0.07] text-ink-2"
                    : "text-ink-3"
              }`}
            >
              <span className="w-8 shrink-0 select-none px-1 text-right text-ink-3/45">
                {row.oldLine ?? ""}
              </span>
              <span className="w-8 shrink-0 select-none border-r border-line/50 px-1 text-right text-ink-3/45">
                {row.newLine ?? ""}
              </span>
              <span
                className={`w-4 shrink-0 select-none text-center ${
                  row.kind === "add"
                    ? "text-ok"
                    : row.kind === "remove"
                      ? "text-danger"
                      : "text-transparent"
                }`}
              >
                {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : "·"}
              </span>
              <code className="pr-3 whitespace-pre">{row.text || " "}</code>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ToolContent({ block }: { block: AgentToolContent }) {
  const { t } = useTranslation();
  if (block.kind === "diff") return <DiffContent block={block} />;
  if (block.kind === "terminal") {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-line bg-app/50 px-2 py-1.5 font-mono text-[10px] text-ink-3">
        <TerminalSquare className="size-3 shrink-0" strokeWidth={1.6} />
        {t("agent.terminalStream", { id: block.terminalId })}
      </div>
    );
  }
  return (
    <div className="group/out relative">
      <pre className="max-h-60 overflow-auto rounded-md border border-line bg-app/50 px-2.5 py-2 font-mono text-[10px] leading-[1.6] whitespace-pre-wrap break-words text-ink-2">
        {block.text}
      </pre>
      <button
        type="button"
        onClick={() => void copyText(block.text)}
        title={t("agent.copyToolOutput")}
        className="absolute right-1 top-1 rounded bg-raised/90 p-1 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover/out:opacity-100"
      >
        <Copy className="size-2.5" />
      </button>
    </div>
  );
}

export default function ToolCard({ item }: { item: ToolItem }) {
  const hasDetail = Boolean(item.detail && item.detail.trim());
  const hasContent = Boolean(item.content?.length);
  const diffs = useMemo(
    () => (item.content ?? []).filter((block): block is DiffBlock => block.kind === "diff"),
    [item.content],
  );
  const totals = useMemo(
    () =>
      diffs.reduce(
        (sum, block) => {
          const stats = diffStats(block);
          return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
        },
        { added: 0, removed: 0 },
      ),
    [diffs],
  );

  const collapsible =
    hasContent ||
    (hasDetail &&
      (item.toolKind === "edit" ||
        item.toolKind === "terminal" ||
        item.toolKind === "execute" ||
        (item.detail?.includes("\n") ?? false)));
  // Edits are the work product — show them without a click. Everything else
  // stays a one-line receipt until asked for.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? diffs.length > 0;
  const failed = item.status === "failed";
  const KindIcon = kindIcons[item.toolKind ?? ""] ?? Wrench;

  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors ${
        failed
          ? "border-danger/30 bg-danger/[0.04]"
          : "border-line bg-raised/35 hover:border-line-strong/70"
      }`}
    >
      <button
        type="button"
        disabled={!collapsible}
        onClick={() => setOverride(!expanded)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left disabled:cursor-default"
      >
        <span
          className={`grid size-5 shrink-0 place-items-center rounded-[5px] border ${
            failed ? "border-danger/25 text-danger" : "border-line bg-app/40 text-ink-2"
          }`}
        >
          <KindIcon className="size-3" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] text-ink">{item.title}</div>
          {!expanded && item.detail && (
            <div className="mt-px truncate font-mono text-[10px] text-ink-3">{item.detail}</div>
          )}
        </div>
        {(totals.added > 0 || totals.removed > 0) && <DiffStat {...totals} />}
        <StatusMark status={item.status} />
        {collapsible && (
          <ChevronRight
            className={`size-3 shrink-0 text-ink-3 transition-transform duration-150 ${
              expanded ? "rotate-90" : ""
            }`}
            strokeWidth={1.6}
          />
        )}
      </button>
      {expanded && (hasContent || hasDetail) && (
        <div className="space-y-1.5 border-t border-line bg-app/30 p-1.5">
          {item.content?.map((block, index) => (
            <ToolContent key={`${block.kind}-${index}`} block={block} />
          ))}
          {!hasContent && hasDetail ? (
            <pre className="max-h-52 overflow-auto px-1 font-mono text-[10px] leading-[1.6] whitespace-pre-wrap break-words text-ink-2">
              {item.detail}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
