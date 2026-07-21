import { AlertTriangle, Info, MessageSquareWarning } from "lucide-react";

import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";

export type ReviewSeverity = "error" | "warn" | "info";

export interface ReviewComment {
  severity: ReviewSeverity;
  path: string;
  line: number;
  endLine?: number;
  message: string;
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
  return comments;
}

function SeverityIcon({ severity }: { severity: ReviewSeverity }) {
  if (severity === "error") return <AlertTriangle className="size-3.5 text-danger" />;
  if (severity === "warn") return <MessageSquareWarning className="size-3.5 text-[#c58a22]" />;
  return <Info className="size-3.5 text-ink-3" />;
}

export default function ReviewCommentCard({ comments }: { comments: ReviewComment[] }) {
  const projectPath = useProjectStore((s) => s.current?.path);

  if (comments.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-xl border border-line/80 bg-panel/60 p-2">
      {comments.map((comment, index) => (
        <button
          key={`${comment.path}:${comment.line}:${index}`}
          type="button"
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
          onClick={() => {
            if (!projectPath) return;
            const absolute = comment.path.includes("/") || comment.path.includes("\\")
              ? comment.path.startsWith(projectPath)
                ? comment.path
                : `${projectPath.replace(/[\\/]+$/, "")}/${comment.path.replace(/^\.?[\\/]/, "")}`
              : `${projectPath.replace(/[\\/]+$/, "")}/${comment.path}`;
            void useEditorStore.getState().openFile(absolute, { line: comment.line });
          }}
        >
          <SeverityIcon severity={comment.severity} />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[10px] text-ink-3">
              {comment.path}:{comment.line}
              {comment.endLine ? `-${comment.endLine}` : ""}
            </span>
            <span className="block text-[11px] text-ink-2">{comment.message}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
