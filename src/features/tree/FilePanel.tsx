import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronRight, FileCode2, Folder, FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { useTranslation } from "react-i18next";

import type { DirEntryInfo } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";

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
  const recents = useProjectStore((s) => s.recents);
  const openProject = useProjectStore((s) => s.openProject);
  const loadRecents = useProjectStore((s) => s.loadRecents);
  const toggleDirectory = useProjectStore((s) => s.toggleDirectory);
  const openFile = useEditorStore((s) => s.openFile);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const rows = useMemo(() => flatten(entries, children, expanded), [children, entries, expanded]);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
    if (typeof dir === "string") await openProject(dir);
  };

  if (!current) {
    return (
      <div className="flex flex-1 flex-col px-4 py-3">
        <button
          onClick={() => void pickFolder()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          <FolderOpen className="size-4" strokeWidth={1.75} />
          {t("empty.openFolder")}
        </button>
        {recents.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {t("panel.recent")}
            </div>
            <div className="flex flex-col gap-1">
              {recents.map((project) => (
                <button
                  key={project.path}
                  onClick={() => void openProject(project.path)}
                  className="rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <div className="truncate text-xs font-medium text-ink-2">{project.name}</div>
                  <div className="truncate text-[10px] text-ink-3">{project.path}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 pb-3">
        <div className="truncate text-xs font-semibold text-ink">{current.name}</div>
        <div className="truncate text-[10px] text-ink-3">{current.path}</div>
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
            return (
              <button
                onClick={() => {
                  if (isDirectory) void toggleDirectory(entry);
                  else void openFile(entry.path);
                }}
                className="flex h-7 w-full items-center gap-1.5 text-left text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                style={{ paddingLeft: 12 + depth * 14 }}
              >
                <ChevronRight
                  className={`size-3 shrink-0 text-ink-3 transition-transform ${isDirectory && open ? "rotate-90" : ""} ${
                    isDirectory ? "opacity-100" : "opacity-0"
                  }`}
                  strokeWidth={1.8}
                />
                <Icon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.6} />
                <span className="truncate">{entry.name}</span>
              </button>
            );
          }}
        />
      )}
    </div>
  );
}
