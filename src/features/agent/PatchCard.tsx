import { Check, FileDiff, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import {
  applyUnifiedPatch,
  patchStats,
  safeProjectRelativePath,
  type UnifiedPatchFile,
} from "@/lib/unifiedPatch";

/** Target path of a patch entry, or null when the entry only deletes a file. */
function targetPath(file: UnifiedPatchFile): string | null {
  if (file.newPath === "/dev/null") return null;
  return safeProjectRelativePath(file.newPath);
}

function joinProject(projectPath: string, relative: string) {
  const separator = projectPath.includes("\\") ? "\\" : "/";
  return `${projectPath.replace(/[\\/]+$/, "")}${separator}${relative.replace(/\//g, separator)}`;
}

export interface PatchCardProps {
  files: UnifiedPatchFile[];
}

/**
 * Applies a multi-file patch offered in chat as a single checkpoint turn, so the
 * review queue sees one reviewable change instead of one per file.
 *
 * Every file is resolved in memory first; nothing is written unless the whole
 * patch applies cleanly against the current working tree.
 */
export default function PatchCard({ files }: PatchCardProps) {
  const { t } = useTranslation();
  const projectPath = useProjectStore((s) => s.current?.path);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (files.length === 0) return null;

  const paths = [...new Set(files.map(targetPath).filter((path): path is string => !!path))];
  const skipped = files.length - files.filter((file) => targetPath(file)).length;
  const stats = patchStats(files);

  const apply = async () => {
    if (!projectPath) {
      setError(t("agent.patchNoProject"));
      return;
    }
    if (paths.length === 0) {
      setError(t("agent.reviewDiffUnsafePath"));
      return;
    }
    setBusy(true);
    setError(null);

    // Resolve first, write second: a hunk that no longer matches must not leave
    // half the patch on disk.
    const resolved = new Map<string, string>();
    try {
      for (const file of files) {
        const relative = targetPath(file);
        if (!relative) continue;
        const absolute = joinProject(projectPath, relative);
        // Two entries for one path chain, so the second hunk set applies to the
        // result of the first rather than to stale text.
        const pending = resolved.get(relative);
        let current: string;
        if (pending !== undefined) {
          current = pending;
        } else if (file.oldPath === "/dev/null") {
          current = "";
        } else {
          current = (await ipc.fsRead(absolute)).content;
        }
        resolved.set(relative, applyUnifiedPatch(current, file.diff));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
      return;
    }

    let turnId: string | null = null;
    let committed = false;
    try {
      const turn = await ipc.ckptBeginTurn(
        projectPath,
        `Apply patch from chat: ${paths.length} files`,
      );
      turnId = turn.id;
      for (const [relative, content] of resolved) {
        await ipc.ckptPreimage(projectPath, joinProject(projectPath, relative));
        await ipc.ckptWriteFile(projectPath, relative, content);
      }
      const meta = await ipc.ckptCommitTurn(projectPath, turn.id);
      committed = true;
      useReviewStore.getState().ingestTurn(meta);
      setApplied(true);
      void useEditorStore.getState().openFile(joinProject(projectPath, paths[0]));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      if (turnId && !committed) {
        try {
          // Close the turn so the partial write is still reviewable and
          // restorable rather than stranded outside any checkpoint.
          const meta = await ipc.ckptCommitTurn(projectPath, turnId);
          useReviewStore.getState().ingestTurn(meta);
        } catch {
          // Keep the original failure.
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-line/80 bg-panel/60 p-2">
      <div className="flex items-start gap-2">
        <FileDiff className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-ink-2">{t("agent.patchTitle")}</div>
          <div className="font-mono text-[10px] text-ink-3">
            {t("agent.patchSummary", { files: paths.length })}
            <span className="ml-1.5 text-ok">+{stats.added}</span>
            <span className="ml-1 text-danger">−{stats.removed}</span>
          </div>
          <ul className="mt-1 space-y-0.5">
            {paths.slice(0, 8).map((path) => (
              <li key={path} className="truncate font-mono text-[10px] text-ink-3">
                {path}
              </li>
            ))}
            {paths.length > 8 && (
              <li className="font-mono text-[10px] text-ink-3">
                {t("agent.patchMoreFiles", { n: paths.length - 8 })}
              </li>
            )}
          </ul>
        </div>
        <button
          type="button"
          disabled={busy || applied}
          onClick={() => void apply()}
          title={t("agent.reviewDiffApplyHint")}
          className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line px-1.5 text-[9.5px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : applied ? (
            <Check className="size-3 text-ok" />
          ) : (
            <FileDiff className="size-3" />
          )}
          {applied ? t("agent.reviewDiffApplied") : t("agent.patchApply")}
        </button>
      </div>
      {skipped > 0 && (
        <p className="mt-1 text-[10px] text-ink-3">
          {t("agent.patchSkipped", { n: skipped })}
        </p>
      )}
      {error && <p className="mt-1 text-[10px] text-danger">{error}</p>}
    </div>
  );
}
