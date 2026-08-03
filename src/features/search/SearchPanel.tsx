import {
  CaseSensitive,
  FileSearch2,
  Loader2,
  Regex,
  Replace,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { GroupedVirtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";

import type { SearchHit } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useSearchStore } from "@/lib/stores/searchStore";

interface SearchGroup {
  name: string;
  directory: string;
  root: string;
  hits: SearchHit[];
}

function projectRelativePath(root: string, path: string) {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function rootName(root: string) {
  const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || normalized;
}

/** Backstop for hits produced before the backend windowed them (a running
 *  search survives a reload): every range becomes a DOM node, so a line with
 *  a million matches would render a million of them. */
const MAX_MARKS_PER_ROW = 100;
const MAX_ROW_CHARS = 1_000;

function highlightedText(text: string, hit: SearchHit): ReactNode {
  if (text.length > MAX_ROW_CHARS) {
    return `${text.slice(0, MAX_ROW_CHARS)}…`;
  }
  const ranges = hit.ranges
    .filter(([start, end]) => start < end && start < text.length)
    .slice(0, MAX_MARKS_PER_ROW);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={`${start}-${parts.length}`}
        className="rounded-sm bg-accent-soft px-px text-ink"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}

function OptionButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`grid size-5 shrink-0 place-items-center rounded transition-colors ${
        active
          ? "bg-accent text-accent-ink"
          : "text-ink-3 hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function SearchPanel() {
  const { t } = useTranslation();
  const roots = useProjectStore((s) => s.roots);
  const rootPaths = useMemo(() => roots.map((root) => root.path), [roots]);
  const query = useSearchStore((s) => s.query);
  const options = useSearchStore((s) => s.options);
  const hits = useSearchStore((s) => s.hits);
  const searching = useSearchStore((s) => s.searching);
  const replacing = useSearchStore((s) => s.replacing);
  const error = useSearchStore((s) => s.error);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setOptions = useSearchStore((s) => s.setOptions);
  const run = useSearchStore((s) => s.run);
  const replaceAll = useSearchStore((s) => s.replaceAll);
  const clear = useSearchStore((s) => s.clear);
  const openFile = useEditorStore((s) => s.openFile);

  const [replacement, setReplacement] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("");

  useEffect(() => {
    if (rootPaths.length === 0 || !query.trim()) return;
    const timer = setTimeout(() => void run(rootPaths, query), 250);
    return () => clearTimeout(timer);
  }, [rootPaths, query, options, run]);

  useEffect(() => {
    setOptions({
      include: includeText
        .split(",")
        .map((glob) => glob.trim())
        .filter(Boolean),
      exclude: excludeText
        .split(",")
        .map((glob) => glob.trim())
        .filter(Boolean),
    });
  }, [includeText, excludeText, setOptions]);

  const groups = useMemo(() => {
    const primary = roots[0]?.path;
    if (!primary) return [] as SearchGroup[];
    const byPath = new Map<string, SearchGroup>();
    for (const hit of hits) {
      let group = byPath.get(hit.path);
      if (!group) {
        const relativePath = projectRelativePath(hit.root || primary, hit.path);
        const segments = relativePath.split("/");
        group = {
          name: segments.pop() || relativePath,
          directory: segments.join("/"),
          root: hit.root || primary,
          hits: [],
        };
        byPath.set(hit.path, group);
      }
      group.hits.push(hit);
    }
    return [...byPath.values()];
  }, [roots, hits]);

  const flattenedHits = useMemo(() => groups.flatMap((group) => group.hits), [groups]);
  const multiRoot = roots.length > 1;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (rootPaths.length > 0) void run(rootPaths, query);
  };

  const onReplaceAll = () => {
    if (!query.trim() || !replacement.trim() || rootPaths.length === 0) return;
    const message = t("search.replaceConfirm", {
      files: hits.length > 0 ? new Set(hits.map((hit) => hit.path)).size : 0,
    });
    if (!window.confirm(message)) return;
    void replaceAll(rootPaths, replacement);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={onSubmit} className="space-y-1.5 px-2 pb-2">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-raised px-2 shadow-[var(--shadow-soft)] transition-colors focus-within:border-ink-3">
          <Search className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) clear();
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
          />
          <OptionButton
            title={t("search.wholeWord")}
            active={options.wholeWord}
            onClick={() => setOptions({ wholeWord: !options.wholeWord })}
          >
            <WholeWord className="size-3" strokeWidth={1.8} />
          </OptionButton>
          <OptionButton
            title={t("search.caseSensitive")}
            active={options.caseSensitive}
            onClick={() => setOptions({ caseSensitive: !options.caseSensitive })}
          >
            <CaseSensitive className="size-3" strokeWidth={1.8} />
          </OptionButton>
          <OptionButton
            title={t("search.regex")}
            active={options.regex}
            onClick={() => setOptions({ regex: !options.regex })}
          >
            <Regex className="size-3" strokeWidth={1.8} />
          </OptionButton>
          {searching ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-3" />
          ) : query ? (
            <button
              type="button"
              onClick={clear}
              aria-label={t("search.clear")}
              title={t("search.clear")}
              className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {query.trim() && hits.length > 0 && (
          <div className="flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-raised px-2 shadow-[var(--shadow-soft)]">
            <Replace className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
            <input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder={t("search.replacePlaceholder")}
              aria-label={t("search.replacePlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={onReplaceAll}
              disabled={!replacement || replacing}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent transition-colors hover:bg-hover disabled:opacity-40"
            >
              {replacing ? t("search.replacing") : t("search.replaceAll")}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          className="px-0.5 text-[10px] text-ink-3 transition-colors hover:text-ink"
        >
          {advancedOpen ? t("search.advancedHide") : t("search.advanced")}
        </button>
        {advancedOpen && (
          <div className="space-y-1.5 rounded-lg border border-line bg-raised p-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-ink-3">{t("search.includeLabel")}</span>
              <input
                value={includeText}
                onChange={(event) => setIncludeText(event.target.value)}
                placeholder={t("search.includePlaceholder")}
                className="w-full rounded border border-line bg-app px-1.5 py-1 font-mono text-[10px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-ink-3">{t("search.excludeLabel")}</span>
              <input
                value={excludeText}
                onChange={(event) => setExcludeText(event.target.value)}
                placeholder={t("search.excludePlaceholder")}
                className="w-full rounded border border-line bg-app px-1.5 py-1 font-mono text-[10px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
              />
            </label>
          </div>
        )}
      </form>

      {error && (
        <div className="mx-2 mb-2 rounded-lg border border-danger/20 bg-danger/5 px-2.5 py-2 text-[10.5px] leading-relaxed text-danger">
          {error}
        </div>
      )}

      {hits.length > 0 && (
        <div className="flex h-7 shrink-0 items-center justify-between border-y border-line/70 px-3 text-[10px] text-ink-3">
          <span>{t("search.summary", { matches: hits.length, files: groups.length })}</span>
          {searching && <span>{t("search.searching")}</span>}
        </div>
      )}

      {rootPaths.length === 0 ? (
        <EmptyState title={t("search.needProject")} />
      ) : hits.length === 0 && !searching ? (
        <EmptyState
          title={query.trim() ? t("search.empty") : t("search.hint")}
          query={query.trim() || undefined}
        />
      ) : hits.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-ink-3">
          <Loader2 className="size-3.5 animate-spin" />
          {t("search.searching")}
        </div>
      ) : (
        <GroupedVirtuoso
          className="min-h-0 flex-1"
          groupCounts={groups.map((group) => group.hits.length)}
          groupContent={(groupIndex) => {
            const group = groups[groupIndex]!;
            return (
              <div className="flex h-8 items-center gap-2 border-b border-line/70 bg-panel px-3">
                <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink-2">
                  {multiRoot && (
                    <span className="mr-1.5 rounded bg-accent-soft px-1 py-px font-mono text-[9px] text-accent">
                      {rootName(group.root)}
                    </span>
                  )}
                  {group.name}
                  {group.directory && (
                    <span className="ml-1.5 font-normal text-ink-3">{group.directory}</span>
                  )}
                </span>
                <span className="rounded-full bg-raised px-1.5 font-mono text-[9px] text-ink-3">
                  {group.hits.length}
                </span>
              </div>
            );
          }}
          itemContent={(itemIndex) => {
            const hit = flattenedHits[itemIndex]!;
            return (
              <button
                type="button"
                onClick={() => void openFile(hit.path, { line: hit.line })}
                title={`${projectRelativePath(hit.root || (rootPaths[0] ?? ""), hit.path)}:${hit.line}`}
                className="group flex w-full items-start gap-2 border-b border-line/40 py-1.5 pl-3 pr-2 text-left transition-colors hover:bg-hover"
              >
                <span className="w-7 shrink-0 pt-px text-right font-mono text-[9.5px] tabular-nums text-ink-3 group-hover:text-ink-2">
                  {hit.line}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-4 text-ink-2">
                  {/* `hit.text` arrives windowed and already left-trimmed, with
                      ranges rebased onto it — trimming again here would shift
                      every highlight. */}
                  {highlightedText(hit.text, hit)}
                </span>
              </button>
            );
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ title, query }: { title: string; query?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
      <span className="mb-2.5 grid size-9 place-items-center rounded-xl border border-line bg-raised text-ink-3 shadow-[var(--shadow-soft)]">
        <FileSearch2 className="size-4" strokeWidth={1.5} />
      </span>
      {query && <span className="mb-1 max-w-full truncate font-mono text-[10px] text-ink-3">“{query}”</span>}
      <p className="text-[11px] leading-relaxed text-ink-3">{title}</p>
    </div>
  );
}
