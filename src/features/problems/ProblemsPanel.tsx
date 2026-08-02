import {
  CircleAlert,
  CircleX,
  Info,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  diagnosticCounts,
  type DiagnosticSeverity,
} from "@/lib/diagnostics";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";

function relativePath(root: string | null, path: string) {
  if (!root) return path;
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  if (severity === "error") {
    return <CircleX className="size-3.5 shrink-0 text-danger" />;
  }
  if (severity === "warning") {
    return <TriangleAlert className="size-3.5 shrink-0 text-warn" />;
  }
  return <Info className="size-3.5 shrink-0 text-accent" />;
}

export default function ProblemsPanel() {
  const { t } = useTranslation();
  const diagnostics = useDiagnosticsStore((state) => state.diagnostics);
  const setOpen = useDiagnosticsStore((state) => state.setProblemsOpen);
  const clearAll = useDiagnosticsStore((state) => state.clearAll);
  const height = useTerminalStore((state) => state.height);
  const projectPath = useProjectStore((state) => state.current?.path ?? null);
  const openFile = useEditorStore((state) => state.openFile);
  const counts = diagnosticCounts(diagnostics);

  return (
    <div
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <CircleAlert className="size-3.5 text-ink-3" strokeWidth={1.6} />
        <span className="text-[11px] font-medium text-ink-2">
          {t("problems.title")}
        </span>
        <span className="text-[10px] tabular-nums text-ink-3">
          {t("problems.summary", {
            errors: counts.error,
            warnings: counts.warning,
            infos: counts.info,
          })}
        </span>
        <div className="flex-1" />
        {diagnostics.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            title={t("problems.clear")}
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <Trash2 className="size-3.5" strokeWidth={1.6} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          title={t("problems.close")}
          className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.6} />
        </button>
      </header>

      {diagnostics.length === 0 ? (
        <div className="grid flex-1 place-items-center text-[11px] text-ink-3">
          {t("problems.empty")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {diagnostics.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                void openFile(item.path, {
                  line: item.line,
                  column: item.column,
                })
              }
              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-hover"
            >
              <SeverityIcon severity={item.severity} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-ink-2">
                  {item.message}
                  {item.code ? (
                    <span className="ml-1 text-ink-3">[{item.code}]</span>
                  ) : null}
                </span>
                <span className="block truncate font-mono text-[9.5px] text-ink-3">
                  {relativePath(projectPath, item.path)}:{item.line}:{item.column}
                  {" · "}
                  {t(`problems.source.${item.source}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
