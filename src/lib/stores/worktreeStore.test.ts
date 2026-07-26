import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    gitWorktreeList: vi.fn(),
    gitWorktreeAdd: vi.fn(),
    gitWorktreeRemove: vi.fn(),
  },
}));

import { ipc, type GitWorktree } from "@/lib/ipc/ipc";

import { useWorktreeStore } from "./worktreeStore";

function worktree(path: string, branch: string | null, isPrimary = false): GitWorktree {
  return {
    path,
    branch,
    head: "abc123",
    detached: branch === null,
    locked: false,
    prunable: false,
    isPrimary,
  };
}

describe("worktreeStore", () => {
  beforeEach(() => {
    useWorktreeStore.getState().reset();
    vi.mocked(ipc.gitWorktreeList).mockReset();
    vi.mocked(ipc.gitWorktreeAdd).mockReset();
    vi.mocked(ipc.gitWorktreeRemove).mockReset();
  });

  it("loads the listing for a project", async () => {
    vi.mocked(ipc.gitWorktreeList).mockResolvedValue([
      worktree("D:/repo", "main", true),
      worktree("D:/wt/feature", "feature"),
    ]);
    await useWorktreeStore.getState().refresh("D:/repo");
    const state = useWorktreeStore.getState();
    expect(state.worktrees).toHaveLength(2);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("reports a non-repository as an empty board with the reason", async () => {
    vi.mocked(ipc.gitWorktreeList).mockRejectedValue(new Error("not a git repository"));
    await useWorktreeStore.getState().refresh("D:/plain");
    const state = useWorktreeStore.getState();
    expect(state.worktrees).toEqual([]);
    expect(state.error).toBe("not a git repository");
    expect(state.loading).toBe(false);
  });

  it("drops a response for a project the user already left", async () => {
    const deferred: { resolve?: (value: GitWorktree[]) => void } = {};
    vi.mocked(ipc.gitWorktreeList).mockImplementation(
      () =>
        new Promise<GitWorktree[]>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    const stale = useWorktreeStore.getState().refresh("D:/first");
    // The user switches projects before the first listing lands.
    useWorktreeStore.setState({ projectPath: "D:/second" });
    deferred.resolve?.([worktree("D:/first", "main", true)]);
    await stale;
    expect(useWorktreeStore.getState().worktrees).toEqual([]);
  });

  it("refreshes after creating and returns the new entry", async () => {
    const created = worktree("D:/wt/fix", "fix");
    vi.mocked(ipc.gitWorktreeAdd).mockResolvedValue(created);
    vi.mocked(ipc.gitWorktreeList).mockResolvedValue([
      worktree("D:/repo", "main", true),
      created,
    ]);
    const result = await useWorktreeStore.getState().create("D:/repo", "fix");
    expect(result).toEqual(created);
    expect(useWorktreeStore.getState().worktrees).toHaveLength(2);
    expect(useWorktreeStore.getState().busy).toBe(false);
  });

  it("surfaces a create failure without clearing the board", async () => {
    useWorktreeStore.setState({ worktrees: [worktree("D:/repo", "main", true)] });
    vi.mocked(ipc.gitWorktreeAdd).mockRejectedValue(new Error("branch fix is already checked out"));
    const result = await useWorktreeStore.getState().create("D:/repo", "fix");
    expect(result).toBeNull();
    expect(useWorktreeStore.getState().error).toContain("already checked out");
    expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
    expect(useWorktreeStore.getState().busy).toBe(false);
  });

  it("takes the post-removal listing straight from the command", async () => {
    vi.mocked(ipc.gitWorktreeRemove).mockResolvedValue([worktree("D:/repo", "main", true)]);
    const ok = await useWorktreeStore.getState().remove("D:/repo", "D:/wt/fix");
    expect(ok).toBe(true);
    expect(ipc.gitWorktreeRemove).toHaveBeenCalledWith("D:/repo", "D:/wt/fix", false);
    expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
  });

  it("keeps the board when removal fails", async () => {
    useWorktreeStore.setState({
      worktrees: [worktree("D:/repo", "main", true), worktree("D:/wt/fix", "fix")],
    });
    vi.mocked(ipc.gitWorktreeRemove).mockRejectedValue(new Error("worktree is dirty"));
    const ok = await useWorktreeStore.getState().remove("D:/repo", "D:/wt/fix");
    expect(ok).toBe(false);
    expect(useWorktreeStore.getState().worktrees).toHaveLength(2);
    expect(useWorktreeStore.getState().error).toBe("worktree is dirty");
  });
});
