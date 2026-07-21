import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    projectOpen: vi.fn(),
    projectRecent: vi.fn(),
    fsList: vi.fn(),
    fsWatchStart: vi.fn(),
    fsWatchStop: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "./editorStore";
import { useProjectStore } from "./projectStore";

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({
      current: null,
      recents: [],
      entries: [],
      children: {},
      expanded: [],
      watcherId: null,
      loading: false,
      error: null,
    });
    vi.mocked(ipc.projectOpen).mockReset();
    vi.mocked(ipc.projectRecent).mockReset();
    vi.mocked(ipc.fsList).mockReset();
    vi.mocked(ipc.fsWatchStart).mockReset();
    vi.mocked(ipc.fsWatchStop).mockReset();
  });

  it("opens a project, lists the root, and starts a watcher", async () => {
    vi.mocked(ipc.projectOpen).mockResolvedValue({ path: "/repo", name: "repo" });
    vi.mocked(ipc.projectRecent).mockResolvedValue([
      { path: "/repo", name: "repo", lastOpenedMs: 1 },
    ]);
    vi.mocked(ipc.fsList).mockResolvedValue([
      { path: "/repo/src", name: "src", kind: "directory" },
      { path: "/repo/README.md", name: "README.md", kind: "file" },
    ]);
    vi.mocked(ipc.fsWatchStart).mockResolvedValue(7);

    await useProjectStore.getState().openProject("/repo");
    const state = useProjectStore.getState();
    expect(state.current?.path).toBe("/repo");
    expect(state.entries).toHaveLength(2);
    expect(state.watcherId).toBe(7);
    expect(state.recents[0]?.name).toBe("repo");
  });

  it("closes the project, watcher, and project-scoped editor state", async () => {
    useProjectStore.setState({
      current: { path: "/repo", name: "repo" },
      watcherId: 7,
      entries: [{ path: "/repo/a.ts", name: "a.ts", kind: "file" }],
      expanded: ["/repo/src"],
    });
    useEditorStore.setState({
      tabs: [
        {
          path: "/repo/a.ts",
          name: "a.ts",
          content: "a",
          savedContent: "a",
          hash: "h",
          truncated: false,
          longLines: false,
          readOnly: false,
        },
      ],
      activePath: "/repo/a.ts",
    });
    vi.mocked(ipc.fsWatchStop).mockResolvedValue();

    await useProjectStore.getState().closeProject();

    expect(ipc.fsWatchStop).toHaveBeenCalledWith(7);
    expect(useProjectStore.getState().current).toBeNull();
    expect(useProjectStore.getState().entries).toEqual([]);
    expect(useEditorStore.getState().tabs).toEqual([]);
  });

  it("expands directories and caches children", async () => {
    useProjectStore.setState({
      current: { path: "/repo", name: "repo" },
      entries: [{ path: "/repo/src", name: "src", kind: "directory" }],
    });
    vi.mocked(ipc.fsList).mockResolvedValue([
      { path: "/repo/src/main.ts", name: "main.ts", kind: "file" },
    ]);

    await useProjectStore.getState().toggleDirectory({
      path: "/repo/src",
      name: "src",
      kind: "directory",
    });

    const state = useProjectStore.getState();
    expect(state.expanded).toContain("/repo/src");
    expect(state.children["/repo/src"]?.[0]?.name).toBe("main.ts");
    expect(ipc.fsList).toHaveBeenCalledTimes(1);

    await useProjectStore.getState().toggleDirectory({
      path: "/repo/src",
      name: "src",
      kind: "directory",
    });
    expect(useProjectStore.getState().expanded).not.toContain("/repo/src");
  });
});
