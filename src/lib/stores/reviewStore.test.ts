import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    ckptListTurns: vi.fn(),
    ckptHunks: vi.fn(),
    ckptFileContents: vi.fn(),
    ckptWriteFile: vi.fn(),
    ckptRestoreFile: vi.fn(),
    ckptRestoreTurn: vi.fn(),
    gitStatus: vi.fn(),
    gitDiffFile: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc/ipc";
import {
  generateCommitMessage,
  MAX_EAGER_WORKING_TREE_DIFFS,
  MAX_WORKING_TREE_FILES,
  reviewFileKey,
  turnsToRestoreBefore,
  unresolvedReviewCount,
  unresolvedReviewGroupCount,
  useReviewStore,
  WORKTREE_GROUP_ID,
} from "./reviewStore";

const turn = {
  id: "turn-1",
  projectPath: "/repo",
  createdAt: 1,
  committedAt: 2,
  label: "change files",
  files: [
    { path: "src/a.ts", status: "modified", preimageAvailable: true },
    { path: "src/b.ts", status: "added", preimageAvailable: true },
  ],
};

describe("reviewStore R1 queue", () => {
  beforeEach(() => {
    useReviewStore.setState({
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
    });
    vi.clearAllMocks();
  });

  it("hydrates turn summaries and a HEAD-based working-tree group", async () => {
    vi.mocked(ipc.ckptListTurns).mockResolvedValue([turn]);
    vi.mocked(ipc.gitStatus).mockResolvedValue([{ path: "README.md", status: " M" }]);
    vi.mocked(ipc.ckptHunks)
      .mockResolvedValueOnce({
        path: "src/a.ts",
        summary: { additions: 3, deletions: 1, hunks: 2, binary: false, available: true },
      })
      .mockResolvedValueOnce({
        path: "src/b.ts",
        summary: { additions: 5, deletions: 0, hunks: 1, binary: false, available: true },
      });
    vi.mocked(ipc.gitDiffFile).mockResolvedValue({
      path: "README.md",
      status: "modified",
      before: "old",
      after: "new",
      summary: { additions: 1, deletions: 1, hunks: 1, binary: false, available: true },
    });
    vi.mocked(ipc.ckptFileContents).mockResolvedValue({
      path: "src/a.ts",
      before: "old",
      after: "new",
    });

    await useReviewStore.getState().refresh("/repo");

    const state = useReviewStore.getState();
    expect(state.workingTree[0]?.path).toBe("README.md");
    expect(state.summaries[reviewFileKey("turn-1", "src/a.ts")]?.hunks).toBe(2);
    expect(state.summaries[reviewFileKey(WORKTREE_GROUP_ID, "README.md")]?.additions).toBe(1);
    expect(state.activeTurnId).toBe("turn-1");
    expect(state.contents?.path).toBe("src/a.ts");
    expect(unresolvedReviewCount(state)).toBe(3);
    expect(unresolvedReviewGroupCount(state)).toBe(2);
  });

  // Opening a folder refreshes the review queue, and a freshly opened folder
  // routinely reports thousands of untracked files. Each `gitDiffFile` spawns
  // git subprocesses and returns both revisions in full, so an unbounded fan-out
  // here launched thousands of processes at once and exhausted host memory.
  it("bounds the working-tree fan-out on a repository with thousands of changes", async () => {
    const statuses = Array.from({ length: 6_000 }, (_, index) => ({
      path: `assets/file-${index}.bin`,
      status: "??",
    }));
    vi.mocked(ipc.ckptListTurns).mockResolvedValue([]);
    vi.mocked(ipc.gitStatus).mockResolvedValue(statuses);

    let live = 0;
    let peak = 0;
    vi.mocked(ipc.gitDiffFile).mockImplementation(async (_project, path) => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      return {
        path,
        status: "added",
        before: "",
        after: "x",
        summary: { additions: 1, deletions: 0, hunks: 1, binary: false, available: true },
      };
    });

    await useReviewStore.getState().refresh("/repo");

    const state = useReviewStore.getState();
    expect(state.workingTree.length).toBe(MAX_WORKING_TREE_FILES);
    // Eager diffs plus the one `selectFile` performs for the initial selection.
    expect(vi.mocked(ipc.gitDiffFile).mock.calls.length).toBeLessThanOrEqual(
      MAX_EAGER_WORKING_TREE_DIFFS + 1,
    );
    expect(peak).toBeLessThanOrEqual(8);
    // Entries past the eager window still appear, as placeholders that hydrate
    // when selected.
    expect(state.workingTree.at(-1)?.summary.available).toBe(false);
    expect(state.workingTree.at(-1)?.status).toBe("added");
  });

  it("keeps the existing accept-file write and advances to the next file", async () => {
    useReviewStore.setState({ turns: [turn], projectPath: "/repo" });
    vi.mocked(ipc.ckptFileContents)
      .mockResolvedValueOnce({ path: "src/a.ts", before: "old", after: "kept" })
      .mockResolvedValueOnce({ path: "src/b.ts", before: "", after: "next" });
    vi.mocked(ipc.ckptWriteFile).mockResolvedValue();

    await useReviewStore.getState().acceptFile("/repo", "turn-1", "src/a.ts");

    expect(ipc.ckptWriteFile).toHaveBeenCalledWith("/repo", "src/a.ts", "kept");
    expect(useReviewStore.getState().decisions[reviewFileKey("turn-1", "src/a.ts")]).toBe(
      "accepted",
    );
    expect(useReviewStore.getState().activeFile).toBe("src/b.ts");
  });

  it("restores a checkpoint file and records the rejection", async () => {
    useReviewStore.setState({ turns: [turn], projectPath: "/repo" });
    vi.mocked(ipc.ckptRestoreFile).mockResolvedValue();
    vi.mocked(ipc.ckptFileContents).mockResolvedValue({
      path: "src/b.ts",
      before: "",
      after: "next",
    });

    await useReviewStore.getState().restoreFile("/repo", "turn-1", "src/a.ts");

    expect(ipc.ckptRestoreFile).toHaveBeenCalledWith("/repo", "turn-1", "src/a.ts");
    expect(useReviewStore.getState().decisions[reviewFileKey("turn-1", "src/a.ts")]).toBe(
      "rejected",
    );
  });

  it("restores every later turn newest-first to reach the target preimage", async () => {
    const newest = { ...turn, id: "turn-3", createdAt: 3 };
    const middle = { ...turn, id: "turn-2", createdAt: 2 };
    const oldest = { ...turn, id: "turn-1", createdAt: 1 };
    useReviewStore.setState({
      turns: [newest, middle, oldest],
      projectPath: "/repo",
    });
    vi.mocked(ipc.ckptRestoreTurn).mockResolvedValue(newest);
    vi.mocked(ipc.ckptListTurns).mockResolvedValue([]);
    vi.mocked(ipc.gitStatus).mockResolvedValue([]);

    expect(turnsToRestoreBefore([newest, middle, oldest], "turn-2")).toEqual([
      newest,
      middle,
    ]);
    await useReviewStore.getState().restoreBeforeTurn("/repo", "turn-2");

    expect(vi.mocked(ipc.ckptRestoreTurn).mock.calls).toEqual([
      ["/repo", "turn-3"],
      ["/repo", "turn-2"],
    ]);
    expect(
      useReviewStore.getState().decisions[reviewFileKey("turn-3", "src/a.ts")],
    ).toBe("rejected");
  });

  it("generates a bounded deterministic commit message from reviewed files", () => {
    const file = {
      path: "docs/README.md",
      status: "modified",
      before: "old",
      after: "new",
      summary: {
        additions: 1,
        deletions: 1,
        hunks: 1,
        binary: false,
        available: true,
      },
    };
    expect(generateCommitMessage([file])).toBe("docs: update project documentation");
    expect(
      generateCommitMessage([
        { ...file, path: "src/a.ts" },
        { ...file, path: "src/b.ts" },
      ]),
    ).toBe("chore: update 2 files");
  });
});
