import { FileSearch2, Loader2, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, type FormEvent, type ReactNode } from "react";
import { GroupedVirtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";

import type { SearchHit } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useSearchStore } from "@/lib/stores/searchStore";

interface SearchGroup {
  name: string;
  directory: string;
  hits: SearchHit[];
}

function projectRelativePath(root: string, path: string) {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function highlightedText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;

  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match = lowerText.indexOf(lowerNeedle);

  while (match >= 0) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(
      <mark
        key={`${match}-${parts.length}`}
        className="rounded-sm bg-accent-soft px-px text-ink"
      >
        {text.slice(match, match + needle.length)}
      </mark>,
    );
    cursor = match + needle.length;
    match = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? <Fragment>{parts}</Fragment> : text;
}

export default function SearchPanel() {
  const { t } = useTranslation();
  const current = useProjectStore((s) => s.current);
  const query = useSearchStore((s) => s.query);
  const hits = useSearchStore((s) => s.hits);
  const searching = useSearchStore((s) => s.searching);
  const error = useSearchStore((s) => s.error);
  const setQuery = useSearchStore((s) => s.setQuery);
  const run = useSearchStore((s) => s.run);
  const clear = useSearchStore((s) => s.clear);
  const openFile = useEditorStore((s) => s.openFile);

  useEffect(() => {
    if (!current || !query.trim()) return;
    const timer = setTimeout(() => void run(current.path, query), 250);
    return () => clearTimeout(timer);
  }, [current, query, run]);

  const groups = useMemo(() => {
    if (!current) return [] as SearchGroup[];
    const byPath = new Map<string, SearchGroup>();
    for (const hit of hits) {
      let group = byPath.get(hit.path);
      if (!group) {
        const relativePath = projectRelativePath(current.path, hit.path);
        const segments = relativePath.split("/");
        group = {
          name: segments.pop() || relativePath,
          directory: segments.join("/"),
          hits: [],
        };
        byPath.set(hit.path, group);
      }
      group.hits.push(hit);
    }
    return [...byPath.values()];
  }, [current, hits]);

  const flattenedHits = useMemo(() => groups.flatMap((group) => group.hits), [groups]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (current) void run(current.path, query);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={onSubmit} className="px-2 pb-2">
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

      {!current ? (
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
                title={`${projectRelativePath(current.path, hit.path)}:${hit.line}`}
                className="group flex w-full items-start gap-2 border-b border-line/40 py-1.5 pl-3 pr-2 text-left transition-colors hover:bg-hover"
              >
                <span className="w-7 shrink-0 pt-px text-right font-mono text-[9.5px] tabular-nums text-ink-3 group-hover:text-ink-2">
                  {hit.line}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-4 text-ink-2">
                  {highlightedText(hit.text.trimStart(), query)}
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
