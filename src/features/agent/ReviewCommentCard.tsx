import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  MessageSquareWarning,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import {
  applyUnifiedPatch,
  extractPatchBlocks,
  safeProjectRelativePath,
} from "@/lib/unifiedPatch";

export type ReviewSeverity = "error" | "warn" | "info";

export interface ReviewComment {
  severity: ReviewSeverity;
  path: string;
  line: number;
  endLine?: number;
  message: string;
  diff?: string;
}

const COMMENT_RE =
  /^\s*[-*]\s*(?:\[(error|warn|info|!)\]\s*)?(?:`?([^`:\s]+)`?:)?(\d+)(?:-(\d+))?\s*[—\-–:]\s*(.+)\s*$/i;

/** Loose parser for agent review bullets. Falls back to [] on mismatch. */
export function parseReviewComments(text: string): ReviewComment[] {
  const comments: ReviewComment[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.match(COMMENT_RE);
    if (!match) continue;
    const severityRaw = (match[1] ?? "info").toLowerCase();
    const severity: ReviewSeverity =
      severityRaw === "error" || severityRaw === "!"
        ? "error"
        : severityRaw === "warn"
          ? "warn"
          : "info";
    const path = match[2] ?? "";
    if (!path) continue;
    comments.push({
      severity,
      path,
      line: Number(match[3]),
      endLine: match[4] ? Number(match[4]) : undefined,
      message: match[5].trim(),
    });
  }
  const diffBlocks = extractPatchBlocks(text);
  // A patch spanning several files belongs to PatchCard, which applies the whole
  // set as one checkpoint turn instead of one turn per file.
  const standalone = diffBlocks.length <= 1;
  for (const file of diffBlocks) {
    const path = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
    const normalized = path.replace(/^\.\//, "");
    const existing = comments.find(
      (comment) => comment.path.replace(/^\.\//, "") === normalized,
    );
    if (existing && !existing.diff) {
      existing.diff = file.diff;
      continue;
    }
    if (!standalone) continue;
    const line = Number(file.diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m)?.[1] ?? 1);
    comments.push({
      severity: "info",
      path: normalized,
      line,
      message: "Suggested change",
      diff: file.diff,
    });
  }
  return comments;
}

/**
 * Files a message offers as a multi-file patch — the ones `parseReviewComments`
 * deliberately leaves alone.
 */
export function parseMessagePatch(text: string) {
  const files = extractPatchBlocks(text);
  if (files.length <= 1) return [];
  const comments = parseReviewComments(text);
  return files.filter((file) => {
    const path = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
    const normalized = path.replace(/^\.\//, "");
    // A diff already adopted by a review bullet keeps its inline apply button.
    return !comments.some(
      (comment) =>
        comment.diff === file.diff && comment.path.replace(/^\.\//, "") === normalized,
    );
  });
}

function SeverityIcon({ severity }: { severity: ReviewSeverity }) {
  if (severity === "error") return <AlertTriangle className="size-3.5 text-danger" />;
    if (severity === "warn") return <MessageSquareWarning className="size-3.5 text-warn" />;
  return <Info className="size-3.5 text-ink-3" />;
}

export default function ReviewCommentCard({ comments }: { comments: ReviewComment[] }) {
  const { t } = useTranslation();
  const projectPath = useProjectStore((s) => s.current?.path);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (comments.length === 0) return null;

  const absoluteFor = (relative: string) => {
    if (!projectPath) return null;
    const safe = safeProjectRelativePath(relative);
    if (!safe) return null;
    const separator = projectPath.includes("\\") ? "\\" : "/";
    return `${projectPath.replace(/[\\/]+$/, "")}${separator}${safe.replace(
      /\//g,
      separator,
    )}`;
  };

  const applySuggestion = async (comment: ReviewComment, key: string) => {
    if (!projectPath || !comment.diff) return;
    const relative = safeProjectRelativePath(comment.path);
    const absolute = relative ? absoluteFor(relative) : null;
    if (!relative || !absolute) {
      setErrors((current) => ({ ...current, [key]: t("agent.reviewDiffUnsafePath") }));
      return;
    }
    setApplying(key);
    setErrors((current) => ({ ...current, [key]: "" }));
    let turnId: string | null = null;
    let committed = false;
    try {
      const current = (await ipc.fsRead(absolute)).content;
      const next = applyUnifiedPatch(current, comment.diff);
      const turn = await ipc.ckptBeginTurn(
        projectPath,
        `Apply review suggestion: ${relative}`,
      );
      turnId = turn.id;
      await ipc.ckptPreimage(projectPath, absolute);
      await ipc.ckptWriteFile(projectPath, relative, next);
      const meta = await ipc.ckptCommitTurn(projectPath, turn.id);
      committed = true;
      useReviewStore.getState().ingestTurn(meta);
      setApplied((current) => new Set(current).add(key));
      void useEditorStore.getState().openFile(absolute, { line: comment.line });
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (turnId && !committed) {
        try {
          await ipc.ckptCommitTurn(projectPath, turnId);
        } catch {
          // Preserve the original apply error.
        }
      }
      setApplying(null);
    }
  };

  return (
    <div className="mt-2 space-y-1.5 rounded-xl border border-line/80 bg-panel/60 p-2">
      {comments.map((comment, index) => {
        const key = `${comment.path}:${comment.line}:${index}`;
        const isApplied = applied.has(key);
        return (
          <div key={key} className="rounded-lg hover:bg-hover">
            <div className="flex items-start gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
                onClick={() => {
                  const absolute = absoluteFor(comment.path);
                  if (absolute) {
                    void useEditorStore
                      .getState()
                      .openFile(absolute, { line: comment.line });
                  }
                }}
              >
                <SeverityIcon severity={comment.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[10px] text-ink-3">
                    {comment.path}:{comment.line}
                    {comment.endLine ? `-${comment.endLine}` : ""}
                  </span>
                  <span className="block text-[11px] text-ink-2">
                    {comment.message}
                  </span>
                </span>
              </button>
              {comment.diff && (
                <button
                  type="button"
                  disabled={applying === key || isApplied}
                  onClick={() => void applySuggestion(comment, key)}
                  title={t("agent.reviewDiffApplyHint")}
                  className="mr-1 mt-1 inline-flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[9.5px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {applying === key ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isApplied ? (
                    <Check className="size-3 text-ok" />
                  ) : (
                    <WandSparkles className="size-3" />
                  )}
                  {isApplied ? t("agent.reviewDiffApplied") : t("agent.reviewDiffApply")}
                </button>
              )}
            </div>
            {errors[key] && (
              <div className="px-2 pb-1.5 text-[10px] text-danger">{errors[key]}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
