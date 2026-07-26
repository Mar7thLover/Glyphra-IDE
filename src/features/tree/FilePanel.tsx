import { ChevronRight, FileCode2, Folder, FolderOpen, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";

import type { DirEntryInfo } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useGitStore } from "@/lib/stores/gitStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { pickProject } from "@/lib/workspaceActions";

interface TreeRow {
  entry: DirEntryInfo;
  depth: number;
}

function flatten(
  entries: DirEntryInfo[],
  children: Record<string, DirEntryInfo[]>,
  expanded: Set<string>,
  depth = 0,
) {
  const rows: TreeRow[] = [];
  for (const entry of entries) {
    rows.push({ entry, depth });
    if (entry.kind === "directory" && expanded.has(entry.path)) {
      rows.push(...flatten(children[entry.path] ?? [], children, expanded, depth + 1));
    }
  }
  return rows;
}

export default function FilePanel() {
  const { t } = useTranslation();
  const current = useProjectStore((s) => s.current);
  const entries = useProjectStore((s) => s.entries);
  const children = useProjectStore((s) => s.children);
  const expandedList = useProjectStore((s) => s.expanded);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const toggleDirectory = useProjectStore((s) => s.toggleDirectory);
  const openFile = useEditorStore((s) => s.openFile);
  const activePath = useEditorStore((s) => s.activePath);
  const statuses = useGitStore((s) => s.statuses);
  const badgeFor = useGitStore((s) => s.badgeFor);

  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const rows = useMemo(() => flatten(entries, children, expanded), [children, entries, expanded]);
  // Touch statuses so badges re-render when git refresh completes.
  void statuses;

  if (!current) {
    return (
      <div className="flex flex-1 flex-col px-3 py-2.5">
        <button
          type="button"
          onClick={() => void pickProject(t("empty.openFolder"), t("menu.unsavedProject"))}
          className="inline-flex items-center gap-1.5 px-1 py-1 text-left text-[11px] text-ink-2 transition-colors hover:text-ink"
        >
          <FolderOpen className="size-3.5 text-ink-3" strokeWidth={1.6} />
          {t("empty.openFolder")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-1">
        <div className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          {current.name}
        </div>
      </div>
      {error && <div className="m-3 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{error}</div>}
      {loading && entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-ink-3">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : (
        <Virtuoso
          className="flex-1"
          data={rows}
          itemContent={(_, row) => {
            const { entry, depth } = row;
            const isDirectory = entry.kind === "directory";
            const open = expanded.has(entry.path);
            const Icon = isDirectory ? (open ? FolderOpen : Folder) : FileCode2;
            const badge = current ? badgeFor(current.path, entry.path) : null;
            const isActive = entry.path === activePath;
            return (
              <button
                onClick={() => {
                  if (isDirectory) void toggleDirectory(entry);
                  else void openFile(entry.path, { preview: true });
                }}
                onDoubleClick={() => {
                  if (!isDirectory) void openFile(entry.path, { preview: false });
                }}
                className={`mx-1.5 flex h-[26px] w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md text-left text-xs transition-colors duration-100 ${
                  isActive ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
                }`}
                style={{ paddingLeft: 6 + depth * 14, paddingRight: 8 }}
              >
                <ChevronRight
                  className={`size-3 shrink-0 text-ink-3 transition-transform ${isDirectory && open ? "rotate-90" : ""} ${
                    isDirectory ? "opacity-100" : "opacity-0"
                  }`}
                  strokeWidth={1.8}
                />
                <Icon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.6} />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {badge && (
                  <span className="shrink-0 font-mono text-[10px] text-accent">{badge}</span>
                )}
              </button>
            );
          }}
        />
      )}
    </div>
  );
}
