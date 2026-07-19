import { Check, PanelRightClose, RotateCcw, Undo2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";

import MergeEditor from "./MergeEditor";

export const REVIEW_WIDTH = 420;

export default function ReviewPanel() {
  const { t } = useTranslation();
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useProjectStore((s) => s.current);
  const open = useReviewStore((s) => s.open);
  const turns = useReviewStore((s) => s.turns);
  const activeTurnId = useReviewStore((s) => s.activeTurnId);
  const activeFile = useReviewStore((s) => s.activeFile);
  const contents = useReviewStore((s) => s.contents);
  const loading = useReviewStore((s) => s.loading);
  const error = useReviewStore((s) => s.error);
  const closeReview = useReviewStore((s) => s.closeReview);
  const selectTurn = useReviewStore((s) => s.selectTurn);
  const selectFile = useReviewStore((s) => s.selectFile);
  const restoreTurn = useReviewStore((s) => s.restoreTurn);
  const restoreFile = useReviewStore((s) => s.restoreFile);
  const acceptFile = useReviewStore((s) => s.acceptFile);
  const writeMerged = useReviewStore((s) => s.writeMerged);

  if (!open || !current) return null;

  const turn = turns.find((item) => item.id === activeTurnId) ?? turns[0] ?? null;

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l border-line bg-panel"
      style={{ width: REVIEW_WIDTH }}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="px-1 text-[11px] font-medium text-ink">{t("review.title")}</span>
        <div className="flex-1" />
        {turn && (
          <button
            type="button"
            title={t("review.restoreTurn")}
            onClick={() => void restoreTurn(current.path, turn.id)}
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <RotateCcw className="size-3.5" strokeWidth={1.6} />
          </button>
        )}
        <button
          type="button"
          onClick={closeReview}
          className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <PanelRightClose className="size-3.5" strokeWidth={1.6} />
        </button>
      </header>

      {error && <div className="px-3 py-1.5 text-[11px] text-danger">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-36 shrink-0 flex-col border-r border-line">
          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {t("review.turns")}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {turns.length === 0 ? (
              <li className="px-2 py-2 text-[11px] text-ink-3">{t("review.empty")}</li>
            ) : (
              turns.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void selectTurn(current.path, item.id)}
                    className={`w-full px-2 py-1.5 text-left text-[11px] ${
                      item.id === activeTurnId ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
                    }`}
                  >
                    <div className="truncate">{item.label}</div>
                    <div className="text-[10px] text-ink-3">
                      {item.files.length} {t("review.files")}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {turn && (
            <ul className="flex max-h-28 shrink-0 flex-col overflow-y-auto border-b border-line">
              {turn.files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => void selectFile(current.path, turn.id, file.path)}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] ${
                      file.path === activeFile ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
                    }`}
                  >
                    <span
                      className={`font-mono text-[10px] ${
                        file.status === "added"
                          ? "text-accent"
                          : file.status === "deleted"
                            ? "text-danger"
                            : "text-ink-3"
                      }`}
                    >
                      {file.status === "added" ? "+" : file.status === "deleted" ? "−" : "±"}
                    </span>
                    <span className="truncate">{file.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeFile && turn && (
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void acceptFile(current.path, turn.id, activeFile)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
              >
                <Check className="size-3" />
                {t("review.acceptFile")}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void restoreFile(current.path, turn.id, activeFile)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
              >
                <Undo2 className="size-3" />
                {t("review.rejectFile")}
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1">
            {contents ? (
              <MergeEditor
                before={contents.before}
                after={contents.after}
                onMerged={(content) => {
                  if (writeTimer.current) clearTimeout(writeTimer.current);
                  writeTimer.current = setTimeout(() => {
                    void writeMerged(current.path, contents.path, content);
                  }, 250);
                }}
              />
            ) : (
              <div className="grid h-full place-items-center px-4 text-center text-[11px] text-ink-3">
                {t("review.pickFile")}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
