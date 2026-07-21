import { Loader2, Search } from "lucide-react";
import { useEffect, type FormEvent } from "react";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";

import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useSearchStore } from "@/lib/stores/searchStore";

export default function SearchPanel() {
  const { t } = useTranslation();
  const current = useProjectStore((s) => s.current);
  const query = useSearchStore((s) => s.query);
  const hits = useSearchStore((s) => s.hits);
  const searching = useSearchStore((s) => s.searching);
  const error = useSearchStore((s) => s.error);
  const setQuery = useSearchStore((s) => s.setQuery);
  const run = useSearchStore((s) => s.run);
  const openFile = useEditorStore((s) => s.openFile);

  useEffect(() => {
    if (!current) return;
    if (!query.trim()) return;
    const timer = setTimeout(() => void run(current.path, query), 220);
    return () => clearTimeout(timer);
  }, [current, query, run]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (current) void run(current.path, query);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={onSubmit} className="border-b border-line px-2 py-2">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-raised px-2">
          <Search className="size-3.5 text-ink-3" strokeWidth={1.6} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            className="h-7 w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
          />
          {searching && <Loader2 className="size-3 animate-spin text-ink-3" />}
        </div>
      </form>
      {error && <div className="px-3 py-1.5 text-[11px] text-danger">{error}</div>}
      {!current ? (
        <p className="px-3 py-4 text-[11px] text-ink-3">{t("search.needProject")}</p>
      ) : hits.length === 0 && !searching ? (
        <p className="px-3 py-4 text-[11px] text-ink-3">
          {query.trim() ? t("search.empty") : t("search.hint")}
        </p>
      ) : (
        <Virtuoso
          className="flex-1"
          data={hits}
          itemContent={(_, hit) => (
            <button
              type="button"
              onClick={() => void openFile(hit.path, { line: hit.line })}
              className="w-full border-b border-line/60 px-3 py-1.5 text-left hover:bg-hover"
            >
              <div className="truncate font-mono text-[10px] text-ink-3">
                {hit.path}:{hit.line}
              </div>
              <div className="truncate text-[11px] text-ink-2">{hit.text}</div>
            </button>
          )}
        />
      )}
    </div>
  );
}
