import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileDiff,
  FileCode2,
  GitCommitHorizontal,
  Loader2,
  PanelRightClose,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { motion } from "motion/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useEditorStore } from "@/lib/stores/editorStore";
import { ipc } from "@/lib/ipc/ipc";
import { useGitStore } from "@/lib/stores/gitStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useUiStore } from "@/lib/stores/uiStore";
import {
  reviewFileKey,
  generateCommitMessage,
  sumDiffs,
  useReviewStore,
  WORKTREE_GROUP_ID,
} from "@/lib/stores/reviewStore";

import MergeEditor, { type MergeEditorHandle } from "./MergeEditor";
import { reviewKeyboardAction } from "./reviewKeyboard";
import WorktreeBoard from "./WorktreeBoard";

export const REVIEW_WIDTH = 500;

function PathLabel({ path }: { path: string }) {
  const normalized = path.replace(/\\/g, "/");
  const split = normalized.lastIndexOf("/");
  const directory = split >= 0 ? normalized.slice(0, split + 1) : "";
  const name = split >= 0 ? normalized.slice(split + 1) : normalized;
  return (
    <span className="flex min-w-0 flex-1 font-mono text-[10.5px]">
      {directory && (
        <span className="min-w-0 truncate text-ink-3" style={{ direction: "rtl" }}>
          {directory}
        </span>
      )}
      <span className="shrink-0 text-ink-2">{name}</span>
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const added = status === "added";
  const deleted = status === "deleted";
  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: added ? "#2e9b62" : deleted ? "#d14b45" : "#c58a22" }}
    >
      {added ? "A" : deleted ? "D" : "M"}
    </span>
  );
}

function DiffBadge({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-hover px-1.5 py-0.5 font-mono text-[9.5px]">
      <span style={{ color: "#2e9b62" }}>+{additions}</span>
      <span style={{ color: "#d14b45" }}>−{deletions}</span>
    </span>
  );
}

export default function ReviewPanel({ variant = "sidebar" }: { variant?: "sidebar" | "page" }) {
  const { t, i18n } = useTranslation();
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const pendingWrite = useRef<{
    projectPath: string;
    turnId: string;
    path: string;
    content: string;
  } | null>(null);
  const mergeRef = useRef<MergeEditorHandle | null>(null);
  const current = useProjectStore((s) => s.current);
  const open = useReviewStore((s) => s.open);
  const turns = useReviewStore((s) => s.turns);
  const workingTree = useReviewStore((s) => s.workingTree);
  const summaries = useReviewStore((s) => s.summaries);
  const decisions = useReviewStore((s) => s.decisions);
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
  const resolveFile = useReviewStore((s) => s.resolveFile);
  const writeMerged = useReviewStore((s) => s.writeMerged);
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set());
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [hunkProgress, setHunkProgress] = useState({ remaining: 0, total: 0 });
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitHash, setCommitHash] = useState<string | null>(null);
  const page = variant === "page";
  const visible = page || open;

  const flushPendingWrite = () => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    const pending = pendingWrite.current;
    pendingWrite.current = null;
    if (pending) {
      void writeMerged(pending.projectPath, pending.turnId, pending.path, pending.content);
    }
  };

  useEffect(() => {
    setHunkProgress({ remaining: 0, total: 0 });
    if (keyboardMode) requestAnimationFrame(() => panelRef.current?.focus());
    return flushPendingWrite;
    // Flush the previous file before the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, activeTurnId]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => panelRef.current?.focus());
  }, [visible]);

  const groups = useMemo(
    () => [
      ...turns.map((turn) => ({
        id: turn.id,
        label: turn.label,
        createdAt: turn.committedAt ?? turn.createdAt,
        files: turn.files,
        readOnly: false,
      })),
      ...(workingTree.length > 0
        ? [
            {
              id: WORKTREE_GROUP_ID,
              label: t("review.workingTree"),
              createdAt: Date.now(),
              files: workingTree,
              readOnly: true,
            },
          ]
        : []),
    ],
    [turns, workingTree, t],
  );
  const flatFiles = useMemo(
    () => groups.flatMap((group) => group.files.map((file) => ({ groupId: group.id, file }))),
    [groups],
  );
  const activeGroup = groups.find((group) => group.id === activeTurnId) ?? null;
  const activeSummary =
    activeTurnId && activeFile
      ? (summaries[reviewFileKey(activeTurnId, activeFile)] ?? null)
      : null;
  const activeCheckpointFile =
    activeGroup && !activeGroup.readOnly
      ? activeGroup.files.find((file) => file.path === activeFile)
      : null;
  const pendingCheckpointFiles = turns.reduce(
    (count, turn) =>
      count +
      turn.files.filter((file) => !decisions[reviewFileKey(turn.id, file.path)]).length,
    0,
  );
  const canCommit = pendingCheckpointFiles === 0 && workingTree.length > 0;

  const openCommit = () => {
    setCommitMessage(generateCommitMessage(workingTree));
    setCommitError(null);
    setCommitOpen(true);
  };

  const commitChanges = async () => {
    const message = commitMessage.trim();
    if (!message || !current) return;
    if (
      !window.confirm(
        t("review.commitConfirm", {
          count: workingTree.length,
          message: message.split(/\r?\n/)[0],
        }),
      )
    ) {
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await ipc.gitCommit(current.path, message);
      setCommitHash(result.hash);
      setCommitOpen(false);
      await Promise.all([
        useReviewStore.getState().refresh(current.path),
        useGitStore.getState().refresh(current.path),
      ]);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitting(false);
    }
  };

  const moveFile = (direction: 1 | -1) => {
    if (!current || flatFiles.length === 0) return;
    const index = flatFiles.findIndex(
      (entry) => entry.groupId === activeTurnId && entry.file.path === activeFile,
    );
    const next = flatFiles[(Math.max(0, index) + direction + flatFiles.length) % flatFiles.length];
    if (next) void selectFile(current.path, next.groupId, next.file.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!current) return;
    const target = event.target as HTMLElement;
    const isEditor = target.closest(".cm-editor") !== null;
    const action = reviewKeyboardAction({
      key: event.key,
      shiftKey: event.shiftKey,
      hasModifier: event.metaKey || event.ctrlKey || event.altKey,
      isEditor,
      keyboardMode,
      hasContents: Boolean(contents),
      hasReviewFile: Boolean(
        activeTurnId && activeTurnId !== WORKTREE_GROUP_ID && activeFile,
      ),
    });
    if (action === "none") return;
    event.preventDefault();
    if (action === "exit-keyboard") setKeyboardMode(false);
    if (action === "next-file") moveFile(1);
    if (action === "previous-file") moveFile(-1);
    if (action === "focus-hunk") {
      setKeyboardMode(true);
      mergeRef.current?.focusFirstHunk();
    }
    if (action === "accept-file" && activeTurnId && activeFile) {
      flushPendingWrite();
      void acceptFile(current.path, activeTurnId, activeFile);
    }
    if (action === "accept-hunk" || action === "reject-hunk") {
      setKeyboardMode(true);
      mergeRef.current?.decide(action === "accept-hunk" ? "accept" : "reject");
    }
  };

  if (!current) return null;

  return (
    <motion.aside
      ref={panelRef}
      initial={false}
      animate={{ width: visible ? (page ? "100%" : REVIEW_WIDTH) : 0 }}
      transition={{ type: "spring", stiffness: 480, damping: 44 }}
      onKeyDown={onKeyDown}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement).closest(".cm-editor")) setKeyboardMode(false);
      }}
      tabIndex={-1}
      className={`${page ? "relative min-w-0 flex-1 overflow-hidden bg-editor" : "glass-panel relative shrink-0 overflow-hidden border-l border-line"}`}
      aria-label={page ? t("review.gitTitle") : t("review.title")}
    >
      <div className="flex h-full flex-col" style={{ width: page ? "100%" : REVIEW_WIDTH }}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <FileDiff className="size-3.5 text-ink-2" strokeWidth={1.7} />
          <span className="text-[12px] font-medium text-ink">
            {page ? t("review.gitTitle") : t("review.title")}
          </span>
          <span className="rounded-full bg-hover px-1.5 py-0.5 text-[9.5px] text-ink-3">
            {flatFiles.length}
          </span>
          <div className="flex-1" />
          <span className="hidden text-[9.5px] text-ink-3 min-[1180px]:inline">
            {t("review.keyboardHint")}
          </span>
          {canCommit && (
            <button
              type="button"
              onClick={openCommit}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] text-ink-2 hover:border-line-strong hover:bg-hover hover:text-ink"
              title={t("review.commitHint")}
            >
              <GitCommitHorizontal className="size-3" />
              {t("review.commit")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setKeyboardMode(false);
              if (page) useUiStore.getState().showWorkspace("editor");
              else closeReview();
            }}
            title={t("review.close")}
            className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <PanelRightClose className="size-3.5" strokeWidth={1.6} />
          </button>
        </header>

        <WorktreeBoard />

        {error && <div className="border-b border-danger/20 px-3 py-1.5 text-[11px] text-danger">{error}</div>}
        {commitHash && (
          <div className="border-b border-ok/20 bg-ok/5 px-3 py-1.5 text-[10.5px] text-ok">
            {t("review.commitCreated", { hash: commitHash.slice(0, 8) })}
          </div>
        )}
        {commitOpen && (
          <div className="border-b border-line bg-raised/65 p-2.5">
            <label className="block text-[10px] font-medium text-ink-2">
              {t("review.commitMessage")}
            </label>
            <textarea
              autoFocus
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              rows={3}
              maxLength={4096}
              className="mt-1 w-full resize-y rounded-lg border border-line bg-editor px-2.5 py-2 font-mono text-[10.5px] text-ink outline-none focus:border-line-strong"
            />
            {commitError && (
              <div className="mt-1 text-[10px] text-danger">{commitError}</div>
            )}
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                disabled={committing}
                onClick={() => setCommitOpen(false)}
                className="rounded-md px-2 py-1 text-[10px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                {t("review.commitCancel")}
              </button>
              <button
                type="button"
                disabled={committing || !commitMessage.trim()}
                onClick={() => void commitChanges()}
                className="btn-accent inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] disabled:opacity-40"
              >
                {committing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <GitCommitHorizontal className="size-3" />
                )}
                {t("review.commitNow")}
              </button>
            </div>
          </div>
        )}

        <div className="max-h-[44%] min-h-28 shrink-0 overflow-y-auto border-b border-line p-2">
          {groups.length === 0 ? (
            <div className="grid min-h-24 place-items-center text-[11px] text-ink-3">
              {t("review.empty")}
            </div>
          ) : (
            groups.map((group) => {
              const groupSummaries = group.files.map(
                (file) => summaries[reviewFileKey(group.id, file.path)] ?? EMPTY_SUMMARY,
              );
              const totals = sumDiffs(groupSummaries);
              const pending = group.readOnly
                ? group.files.length
                : group.files.filter((file) => !decisions[reviewFileKey(group.id, file.path)]).length;
              const complete = !group.readOnly && pending === 0;
              const expanded = !complete || expandedCompleted.has(group.id);
              return (
                <section
                  key={group.id}
                  className={`mb-2 overflow-hidden rounded-xl border border-line bg-raised/45 transition-opacity ${complete ? "opacity-65" : ""}`}
                >
                  <div className="flex items-start gap-2 px-2.5 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (complete) {
                          setExpandedCompleted((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          });
                        } else {
                          void selectTurn(current.path, group.id);
                        }
                      }}
                      className="mt-0.5 text-ink-3 hover:text-ink"
                    >
                      {complete ? (
                        expanded ? <ChevronDown className="size-3.5" /> : <CheckCircle2 className="size-3.5 text-ok" />
                      ) : expanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                          {group.label.slice(0, 48)}
                        </span>
                        {group.readOnly && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-hover px-1.5 py-0.5 text-[9px] text-ink-3">
                            <Eye className="size-2.5" /> {t("review.readOnly")}
                          </span>
                        )}
                        <DiffBadge additions={totals.additions} deletions={totals.deletions} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[9.5px] text-ink-3">
                        <span>
                          {new Intl.DateTimeFormat(i18n.language, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(group.createdAt)}
                        </span>
                        <span>·</span>
                        <span>{group.files.length} {t("review.files")}</span>
                        {!group.readOnly && pending > 0 && <span>· {pending} {t("review.pending")}</span>}
                      </div>
                    </div>
                    {!group.readOnly && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          flushPendingWrite();
                          void restoreTurn(current.path, group.id);
                        }}
                        title={t("review.restoreTurn")}
                        className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-40"
                      >
                        <RotateCcw className="size-3.5" strokeWidth={1.6} />
                      </button>
                    )}
                  </div>

                  {expanded && (
                    <ul className="border-t border-line/70 py-1">
                      {group.files.map((file) => {
                        const summary = summaries[reviewFileKey(group.id, file.path)] ?? EMPTY_SUMMARY;
                        const decision = decisions[reviewFileKey(group.id, file.path)];
                        const active = group.id === activeTurnId && file.path === activeFile;
                        return (
                          <li key={file.path} className={decision ? "opacity-50" : ""}>
                            <div
                              className={`group/file flex items-center gap-1.5 px-2 py-1 ${active ? "bg-active" : "hover:bg-hover"}`}
                            >
                              <button
                                type="button"
                                onClick={() => void selectFile(current.path, group.id, file.path)}
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                              >
                                {decision ? (
                                  decision === "accepted" ? <Check className="size-4 shrink-0 text-ok" /> : <Undo2 className="size-4 shrink-0 text-danger" />
                                ) : (
                                  <StatusDot status={file.status} />
                                )}
                                <PathLabel path={file.path} />
                                {summary.available ? (
                                  <>
                                    <span className="shrink-0 text-[9.5px] text-ink-3">
                                      {summary.hunks}h
                                    </span>
                                    <DiffBadge additions={summary.additions} deletions={summary.deletions} />
                                  </>
                                ) : (
                                  <span className="shrink-0 text-[9px] text-ink-3">{t("review.noBaseline")}</span>
                                )}
                              </button>
                              {!group.readOnly && !decision && (
                                <div className="flex shrink-0 opacity-0 transition-opacity group-hover/file:opacity-100 focus-within:opacity-100">
                                  <button
                                    type="button"
                                    disabled={loading}
                                    onClick={() => {
                                      flushPendingWrite();
                                      void acceptFile(current.path, group.id, file.path);
                                    }}
                                    title={t("review.acceptFile")}
                                    className="rounded p-1 text-ink-3 hover:bg-raised hover:text-ok"
                                  >
                                    <Check className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={loading || !("preimageAvailable" in file && file.preimageAvailable)}
                                    onClick={() => {
                                      flushPendingWrite();
                                      void restoreFile(current.path, group.id, file.path);
                                    }}
                                    title={t("review.rejectFile")}
                                    className="rounded p-1 text-ink-3 hover:bg-raised hover:text-danger disabled:opacity-30"
                                  >
                                    <Undo2 className="size-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-editor">
          {activeFile && activeGroup && (
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
              <PathLabel path={activeFile} />
              {activeSummary?.available && (
                <DiffBadge additions={activeSummary.additions} deletions={activeSummary.deletions} />
              )}
              {hunkProgress.total > 0 && (
                <span className="shrink-0 text-[9.5px] text-ink-3">
                  {Math.min(hunkProgress.total, hunkProgress.total - hunkProgress.remaining + 1)}/{hunkProgress.total}
                </span>
              )}
              {current && activeFile && (
                <button
                  type="button"
                  onClick={() => {
                    const absolute = activeFile.includes("/") || activeFile.includes("\\")
                      ? activeFile.startsWith(current.path)
                        ? activeFile
                        : `${current.path.replace(/[\\/]+$/, "")}/${activeFile.replace(/^\.?[\\/]/, "")}`
                      : `${current.path.replace(/[\\/]+$/, "")}/${activeFile}`;
                    void useEditorStore.getState().openFile(absolute);
                  }}
                  title={t("review.openInEditor")}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <FileCode2 className="size-3" /> {t("review.openInEditor")}
                </button>
              )}
              {activeGroup.readOnly ? (
                <span className="rounded-full bg-hover px-1.5 py-0.5 text-[9px] text-ink-3">HEAD</span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      flushPendingWrite();
                      void acceptFile(current.path, activeGroup.id, activeFile);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <Check className="size-3" /> {t("review.acceptFile")}
                  </button>
                  <button
                    type="button"
                    disabled={
                      loading ||
                      !activeCheckpointFile ||
                      !("preimageAvailable" in activeCheckpointFile) ||
                      !activeCheckpointFile.preimageAvailable
                    }
                    onClick={() => {
                      flushPendingWrite();
                      void restoreFile(current.path, activeGroup.id, activeFile);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-2 hover:border-danger/30 hover:bg-danger/5 hover:text-danger disabled:opacity-30"
                  >
                    <Undo2 className="size-3" /> {t("review.rejectFile")}
                  </button>
                </>
              )}
            </div>
          )}

          {keyboardMode && (
            <div className="shrink-0 border-b border-line bg-accent-soft px-3 py-1 text-[9.5px] text-ink-2">
              {t("review.keyboardMode")}
            </div>
          )}

          <div className="flex min-h-0 flex-1">
            {contents && activeSummary?.available && !activeSummary.binary ? (
              <MergeEditor
                ref={mergeRef}
                before={contents.before}
                after={contents.after}
                readOnly={activeTurnId === WORKTREE_GROUP_ID}
                acceptLabel={t("review.acceptHunk")}
                rejectLabel={t("review.rejectHunk")}
                onHunkProgress={(remaining, total) => setHunkProgress({ remaining, total })}
                onResolved={() => {
                  if (activeTurnId && activeFile && activeTurnId !== WORKTREE_GROUP_ID) {
                    void resolveFile(current.path, activeTurnId, activeFile);
                  }
                }}
                onMerged={(content) => {
                  if (activeTurnId === WORKTREE_GROUP_ID) return;
                  if (writeTimer.current) clearTimeout(writeTimer.current);
                  if (activeTurnId) {
                    pendingWrite.current = {
                      projectPath: current.path,
                      turnId: activeTurnId,
                      path: contents.path,
                      content,
                    };
                  }
                  writeTimer.current = setTimeout(() => {
                    flushPendingWrite();
                  }, 250);
                }}
              />
            ) : contents && activeSummary?.binary ? (
              <div className="m-4 grid flex-1 place-items-center rounded-xl border border-line bg-raised/45 px-6 text-center text-[11px] text-ink-3">
                {t("review.binary")}
              </div>
            ) : contents && activeSummary && !activeSummary.available ? (
              <div className="m-4 grid flex-1 place-items-center rounded-xl border border-line bg-raised/45 px-6 text-center text-[11px] text-ink-3">
                {t("review.noBaselineDetail")}
              </div>
            ) : (
              <div className="grid flex-1 place-items-center px-4 text-center text-[11px] text-ink-3">
                {loading ? t("review.loading") : t("review.pickFile")}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.aside>
  );
}

const EMPTY_SUMMARY = {
  additions: 0,
  deletions: 0,
  hunks: 0,
  binary: false,
  available: false,
};
