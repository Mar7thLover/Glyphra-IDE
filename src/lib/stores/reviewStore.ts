import { create } from "zustand";

import {
  ipc,
  type CkptFileContents,
  type CkptTurnMeta,
  type DiffSummary,
  type GitFileDiff,
} from "@/lib/ipc/ipc";

export const WORKTREE_GROUP_ID = "__working-tree__";

export type ReviewDecision = "accepted" | "rejected";

const EMPTY_SUMMARY: DiffSummary = {
  additions: 0,
  deletions: 0,
  hunks: 0,
  binary: false,
  available: false,
};

export function reviewFileKey(groupId: string, path: string) {
  return `${groupId}\u0000${path}`;
}

export function sumDiffs(summaries: DiffSummary[]) {
  return summaries.reduce(
    (total, summary) => ({
      additions: total.additions + summary.additions,
      deletions: total.deletions + summary.deletions,
      hunks: total.hunks + summary.hunks,
    }),
    { additions: 0, deletions: 0, hunks: 0 },
  );
}

function storageKey(projectPath: string) {
  return `glyphra.review.decisions:${projectPath.replace(/\\/g, "/")}`;
}

function loadDecisions(projectPath: string): Record<string, ReviewDecision> {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectPath)) ?? "{}") as Record<
      string,
      ReviewDecision
    >;
    return Object.fromEntries(
      Object.entries(value).filter(([, decision]) =>
        decision === "accepted" || decision === "rejected",
      ),
    );
  } catch {
    return {};
  }
}

function saveDecisions(projectPath: string, decisions: Record<string, ReviewDecision>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectPath), JSON.stringify(decisions));
  } catch {
    // Review decisions are an audit convenience; storage quota must not block a decision.
  }
}

function checkpointFiles(turns: CkptTurnMeta[]) {
  return turns.flatMap((turn) => turn.files.map((file) => ({ turnId: turn.id, path: file.path })));
}

function firstPending(
  turns: CkptTurnMeta[],
  decisions: Record<string, ReviewDecision>,
  after?: { turnId: string; path: string },
) {
  const files = checkpointFiles(turns);
  const start = after
    ? Math.max(
        0,
        files.findIndex((file) => file.turnId === after.turnId && file.path === after.path) + 1,
      )
    : 0;
  return (
    [...files.slice(start), ...files.slice(0, start)].find(
      (file) => !decisions[reviewFileKey(file.turnId, file.path)],
    ) ?? null
  );
}

interface ReviewState {
  projectPath: string | null;
  turns: CkptTurnMeta[];
  workingTree: GitFileDiff[];
  summaries: Record<string, DiffSummary>;
  decisions: Record<string, ReviewDecision>;
  activeTurnId: string | null;
  activeFile: string | null;
  contents: CkptFileContents | null;
  open: boolean;
  loading: boolean;
  error: string | null;
  ingestTurn: (turn: CkptTurnMeta) => void;
  refresh: (projectPath: string) => Promise<void>;
  refreshWorkingTree: (projectPath: string) => Promise<void>;
  openReview: (projectPath?: string) => void;
  closeReview: () => void;
  selectTurn: (projectPath: string, turnId: string) => Promise<void>;
  selectFile: (projectPath: string, turnId: string, path: string) => Promise<void>;
  restoreTurn: (projectPath: string, turnId: string) => Promise<void>;
  restoreFile: (projectPath: string, turnId: string, path: string) => Promise<void>;
  acceptFile: (projectPath: string, turnId: string, path: string) => Promise<void>;
  resolveFile: (
    projectPath: string,
    turnId: string,
    path: string,
    decision?: ReviewDecision,
  ) => Promise<void>;
  writeMerged: (
    projectPath: string,
    turnId: string,
    path: string,
    content: string,
  ) => Promise<void>;
}

function placeholderWorktree(path: string, status: string): GitFileDiff {
  const normalized = status.includes("D") ? "deleted" : status.includes("A") || status === "??" ? "added" : "modified";
  return { path, status: normalized, before: "", after: "", summary: EMPTY_SUMMARY };
}

export function unresolvedReviewCount(state: Pick<ReviewState, "turns" | "workingTree" | "decisions">) {
  const checkpointPending = checkpointFiles(state.turns).filter(
    (file) => !state.decisions[reviewFileKey(file.turnId, file.path)],
  ).length;
  return checkpointPending + state.workingTree.length;
}

export function unresolvedReviewGroupCount(
  state: Pick<ReviewState, "turns" | "workingTree" | "decisions">,
) {
  const checkpointGroups = state.turns.filter((turn) =>
    turn.files.some((file) => !state.decisions[reviewFileKey(turn.id, file.path)]),
  ).length;
  return checkpointGroups + Number(state.workingTree.length > 0);
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  projectPath: null,
  turns: [],
  workingTree: [],
  summaries: {},
  decisions: {},
  activeTurnId: null,
  activeFile: null,
  contents: null,
  open: false,
  loading: false,
  error: null,

  ingestTurn: (turn) => {
    if (turn.files.length === 0) return;
    set((state) => ({
      turns: [turn, ...state.turns.filter((item) => item.id !== turn.id)],
      projectPath: turn.projectPath,
      activeTurnId: turn.id,
      activeFile: turn.files[0]?.path ?? null,
      open: true,
      contents: null,
    }));
    void get().refresh(turn.projectPath);
  },

  refresh: async (projectPath) => {
    set({ loading: true, error: null });
    try {
      const [turns, statuses] = await Promise.all([
        ipc.ckptListTurns(projectPath),
        ipc.gitStatus(projectPath),
      ]);
      const checkpointSummaries = await Promise.all(
        turns.flatMap((turn) =>
          turn.files.map(async (file) => {
            const key = reviewFileKey(turn.id, file.path);
            try {
              const result = await ipc.ckptHunks(projectPath, turn.id, file.path);
              return [key, result.summary] as const;
            } catch {
              return [key, EMPTY_SUMMARY] as const;
            }
          }),
        ),
      );
      const workingTree = await Promise.all(
        statuses.map(async (entry) => {
          try {
            return await ipc.gitDiffFile(projectPath, entry.path, "HEAD");
          } catch {
            return placeholderWorktree(entry.path, entry.status);
          }
        }),
      );
      const summaries = Object.fromEntries(checkpointSummaries);
      for (const file of workingTree) {
        summaries[reviewFileKey(WORKTREE_GROUP_ID, file.path)] = file.summary;
      }

      const projectChanged = get().projectPath !== projectPath;
      const decisions = projectChanged ? loadDecisions(projectPath) : get().decisions;
      const activeTurnId = get().activeTurnId;
      const activeFile = get().activeFile;
      const selectionExists =
        activeTurnId === WORKTREE_GROUP_ID
          ? workingTree.some((file) => file.path === activeFile)
          : turns.some(
              (turn) =>
                turn.id === activeTurnId && turn.files.some((file) => file.path === activeFile),
            );
      const fallback = firstPending(turns, decisions);
      const selection = selectionExists
        ? { turnId: activeTurnId!, path: activeFile! }
        : fallback ??
          (workingTree[0]
            ? { turnId: WORKTREE_GROUP_ID, path: workingTree[0].path }
            : turns[0]?.files[0]
              ? { turnId: turns[0].id, path: turns[0].files[0].path }
              : null);

      set({
        projectPath,
        turns,
        workingTree,
        summaries,
        decisions,
        activeTurnId: selection?.turnId ?? null,
        activeFile: selection?.path ?? null,
        contents: null,
        loading: false,
      });
      if (selection) await get().selectFile(projectPath, selection.turnId, selection.path);
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  refreshWorkingTree: async (projectPath) => {
    try {
      const statuses = await ipc.gitStatus(projectPath);
      const existing = new Map(get().workingTree.map((file) => [file.path, file]));
      const workingTree = statuses.map(
        (entry) => existing.get(entry.path) ?? placeholderWorktree(entry.path, entry.status),
      );
      set({ workingTree });
    } catch {
      set({ workingTree: [] });
    }
  },

  openReview: (projectPath) => {
    set({ open: true });
    if (projectPath) void get().refresh(projectPath);
  },
  closeReview: () => set({ open: false }),

  selectTurn: async (projectPath, turnId) => {
    const files =
      turnId === WORKTREE_GROUP_ID
        ? get().workingTree
        : (get().turns.find((item) => item.id === turnId)?.files ?? []);
    const file =
      files.find((item) => !get().decisions[reviewFileKey(turnId, item.path)]) ?? files[0];
    set({ activeTurnId: turnId, activeFile: file?.path ?? null, contents: null });
    if (file) await get().selectFile(projectPath, turnId, file.path);
  },

  selectFile: async (projectPath, turnId, path) => {
    set({ loading: true, activeTurnId: turnId, activeFile: path, error: null });
    try {
      if (turnId === WORKTREE_GROUP_ID) {
        const diff = await ipc.gitDiffFile(projectPath, path, "HEAD");
        set((state) => ({
          workingTree: state.workingTree.map((item) => (item.path === path ? diff : item)),
          summaries: {
            ...state.summaries,
            [reviewFileKey(WORKTREE_GROUP_ID, path)]: diff.summary,
          },
          contents: { path: diff.path, before: diff.before, after: diff.after },
          loading: false,
        }));
      } else {
        const contents = await ipc.ckptFileContents(projectPath, turnId, path);
        set({ contents, loading: false });
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  restoreTurn: async (projectPath, turnId) => {
    if (turnId === WORKTREE_GROUP_ID) return;
    set({ loading: true, error: null });
    try {
      await ipc.ckptRestoreTurn(projectPath, turnId);
      const turn = get().turns.find((item) => item.id === turnId);
      const decisions = { ...get().decisions };
      for (const file of turn?.files ?? []) {
        decisions[reviewFileKey(turnId, file.path)] = "rejected";
      }
      saveDecisions(projectPath, decisions);
      set({
        decisions,
        loading: false,
        contents: null,
        activeTurnId: null,
        activeFile: null,
      });
      await get().refresh(projectPath);
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  restoreFile: async (projectPath, turnId, path) => {
    if (turnId === WORKTREE_GROUP_ID) return;
    set({ loading: true, error: null });
    try {
      await ipc.ckptRestoreFile(projectPath, turnId, path);
      await get().resolveFile(projectPath, turnId, path, "rejected");
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  acceptFile: async (projectPath, turnId, path) => {
    if (turnId === WORKTREE_GROUP_ID) return;
    set({ loading: true, error: null });
    try {
      const contents = await ipc.ckptFileContents(projectPath, turnId, path);
      await ipc.ckptWriteFile(projectPath, path, contents.after);
      await get().resolveFile(projectPath, turnId, path, "accepted");
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  resolveFile: async (projectPath, turnId, path, decision = "accepted") => {
    if (turnId === WORKTREE_GROUP_ID) return;
    const decisions = {
      ...get().decisions,
      [reviewFileKey(turnId, path)]: decision,
    };
    saveDecisions(projectPath, decisions);
    const next = firstPending(get().turns, decisions, { turnId, path });
    set({ decisions, loading: false });
    if (next) {
      await get().selectFile(projectPath, next.turnId, next.path);
    } else if (get().workingTree[0]) {
      await get().selectFile(
        projectPath,
        WORKTREE_GROUP_ID,
        get().workingTree[0]!.path,
      );
    } else {
      set({ contents: null, activeTurnId: null, activeFile: null });
    }
  },

  writeMerged: async (projectPath, turnId, path, content) => {
    if (turnId === WORKTREE_GROUP_ID) return;
    await ipc.ckptWriteFile(projectPath, path, content);
  },
}));
