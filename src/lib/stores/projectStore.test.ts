import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    projectOpen: vi.fn(),
    projectRecent: vi.fn(),
    fsList: vi.fn(),
    fsWatchStart: vi.fn(),
    fsWatchStop: vi.fn(),
    gitExecReadonly: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "./editorStore";
import { useProjectStore } from "./projectStore";

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({
      current: null,
      roots: [],
      recents: [],
      entriesByRoot: {},
      children: {},
      expanded: [],
      watcherIds: {},
      loading: false,
      error: null,
    });
    vi.mocked(ipc.projectOpen).mockReset();
    vi.mocked(ipc.projectRecent).mockReset();
    vi.mocked(ipc.fsList).mockReset();
    vi.mocked(ipc.fsWatchStart).mockReset();
    vi.mocked(ipc.fsWatchStop).mockReset();
    vi.mocked(ipc.gitExecReadonly).mockReset();
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
    expect(state.roots.map((root) => root.path)).toEqual(["/repo"]);
    expect(state.entriesByRoot["/repo"]).toHaveLength(2);
    expect(state.watcherIds["/repo"]).toBe(7);
    expect(state.recents[0]?.name).toBe("repo");
  });

  it("opens a multi-folder workspace with per-root entries and watchers", async () => {
    vi.mocked(ipc.projectOpen).mockImplementation(async (path: string) => ({
      path,
      name: path.split("/").pop() ?? path,
    }));
    vi.mocked(ipc.projectRecent).mockResolvedValue([]);
    vi.mocked(ipc.fsList).mockImplementation(async (path: string) =>
      path === "/first"
        ? [{ path: "/first/a.ts", name: "a.ts", kind: "file" }]
        : [{ path: "/second/b.ts", name: "b.ts", kind: "file" }],
    );
    vi.mocked(ipc.fsWatchStart).mockResolvedValue(1);

    await useProjectStore.getState().openWorkspace(["/first", "/second"]);
    const state = useProjectStore.getState();
    expect(state.current?.path).toBe("/first");
    expect(state.roots.map((root) => root.path)).toEqual(["/first", "/second"]);
    expect(state.entriesByRoot["/first"]).toHaveLength(1);
    expect(state.entriesByRoot["/second"]).toHaveLength(1);
    expect(state.watcherIds["/first"]).toBe(1);
    expect(state.watcherIds["/second"]).toBe(1);
  });

  it("adds and removes workspace folders without losing the primary root", async () => {
    vi.mocked(ipc.projectOpen).mockImplementation(async (path: string) => ({
      path,
      name: path.split("/").pop() ?? path,
    }));
    vi.mocked(ipc.projectRecent).mockResolvedValue([]);
    vi.mocked(ipc.fsList).mockResolvedValue([]);
    vi.mocked(ipc.fsWatchStart).mockResolvedValue(1);

    await useProjectStore.getState().openWorkspace(["/first"]);
    await useProjectStore.getState().addFolder("/second");
    expect(useProjectStore.getState().roots.map((root) => root.path)).toEqual([
      "/first",
      "/second",
    ]);
    expect(useProjectStore.getState().current?.path).toBe("/first");

    await useProjectStore.getState().removeFolder("/second");
    expect(useProjectStore.getState().roots.map((root) => root.path)).toEqual(["/first"]);
    expect(useProjectStore.getState().current?.path).toBe("/first");
  });

  it("promotes the next root when the primary folder is removed", async () => {
    vi.mocked(ipc.projectOpen).mockImplementation(async (path: string) => ({
      path,
      name: path.split("/").pop() ?? path,
    }));
    vi.mocked(ipc.projectRecent).mockResolvedValue([]);
    vi.mocked(ipc.fsList).mockResolvedValue([]);
    vi.mocked(ipc.fsWatchStart).mockResolvedValue(1);

    await useProjectStore.getState().openWorkspace(["/first", "/second"]);
    await useProjectStore.getState().removeFolder("/first");
    expect(useProjectStore.getState().current?.path).toBe("/second");
    expect(useProjectStore.getState().roots.map((root) => root.path)).toEqual(["/second"]);
  });

  it("resolves the workspace root for a file path", async () => {
    useProjectStore.setState({
      current: { path: "/first", name: "first" },
      roots: [
        { path: "/first", name: "first" },
        { path: "/second", name: "second" },
      ],
    });
    expect(useProjectStore.getState().rootForFile("/first/src/a.ts")).toBe("/first");
    expect(useProjectStore.getState().rootForFile("/second/b.ts")).toBe("/second");
    expect(useProjectStore.getState().rootForFile("/elsewhere/c.ts")).toBeNull();
  });

  it("closes the project, watcher, and project-scoped editor state", async () => {
    useProjectStore.setState({
      current: { path: "/repo", name: "repo" },
      roots: [{ path: "/repo", name: "repo" }],
      watcherIds: { "/repo": 7 },
      entriesByRoot: { "/repo": [{ path: "/repo/a.ts", name: "a.ts", kind: "file" }] },
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
          encoding: "UTF-8",
          savedEncoding: "UTF-8",
          bom: false,
          savedBom: false,
        },
      ],
      activePath: "/repo/a.ts",
    });
    vi.mocked(ipc.fsWatchStop).mockResolvedValue();

    await useProjectStore.getState().closeProject();

    expect(ipc.fsWatchStop).toHaveBeenCalledWith(7);
    expect(useProjectStore.getState().current).toBeNull();
    expect(useProjectStore.getState().entriesByRoot).toEqual({});
    expect(useEditorStore.getState().tabs).toEqual([]);
  });

  it("expands directories and caches children", async () => {
    useProjectStore.setState({
      current: { path: "/repo", name: "repo" },
      roots: [{ path: "/repo", name: "repo" }],
      entriesByRoot: { "/repo": [{ path: "/repo/src", name: "src", kind: "directory" }] },
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
