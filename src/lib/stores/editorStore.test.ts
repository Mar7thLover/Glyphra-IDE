import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    fsRead: vi.fn(),
    fsWrite: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc/ipc";
import { useUnsavedChangesStore } from "@/lib/unsavedChanges";
import { useEditorStore } from "./editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activePath: null,
      loading: false,
      error: null,
      reveal: null,
    });
    vi.mocked(ipc.fsRead).mockReset();
    vi.mocked(ipc.fsWrite).mockReset();
    useUnsavedChangesStore.setState({ pending: null });
  });

  it("opens a file tab and marks degraded long-line files read-only", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/wide.txt",
      content: "x".repeat(20),
      hash: "abc",
      truncated: false,
      longLines: true,
      readOnly: true,
    });

    await useEditorStore.getState().openFile("/tmp/wide.txt");
    const state = useEditorStore.getState();
    expect(state.activePath).toBe("/tmp/wide.txt");
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.longLines).toBe(true);
    expect(state.tabs[0]?.readOnly).toBe(true);
  });

  it("queues a reveal target when opening with a line", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/a.ts",
      content: "a\nb\nc\n",
      hash: "h1",
      truncated: false,
      longLines: false,
      readOnly: false,
    });

    await useEditorStore.getState().openFile("/tmp/a.ts", { line: 2, column: 1 });
    expect(useEditorStore.getState().reveal).toEqual({
      path: "/tmp/a.ts",
      line: 2,
      column: 1,
      token: expect.any(Number),
    });
  });

  it("reloads clean tabs from disk on syncFromDisk", async () => {
    useEditorStore.setState({
      tabs: [
        {
          path: "/tmp/a.ts",
          name: "a.ts",
          content: "old",
          savedContent: "old",
          hash: "h1",
          truncated: false,
          longLines: false,
          readOnly: false,
        },
        {
          path: "/tmp/dirty.ts",
          name: "dirty.ts",
          content: "local",
          savedContent: "disk",
          hash: "d1",
          truncated: false,
          longLines: false,
          readOnly: false,
        },
      ],
      activePath: "/tmp/a.ts",
    });

    vi.mocked(ipc.fsRead).mockImplementation(async (path: string) => {
      if (path === "/tmp/a.ts") {
        return {
          path,
          content: "new",
          hash: "h2",
          truncated: false,
          longLines: false,
          readOnly: false,
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    await useEditorStore.getState().syncFromDisk(["/tmp/a.ts", "/tmp/dirty.ts"]);
    const state = useEditorStore.getState();
    expect(state.tabs.find((tab) => tab.path === "/tmp/a.ts")?.content).toBe("new");
    expect(state.tabs.find((tab) => tab.path === "/tmp/a.ts")?.hash).toBe("h2");
    expect(state.tabs.find((tab) => tab.path === "/tmp/dirty.ts")?.content).toBe("local");
    expect(ipc.fsRead).toHaveBeenCalledWith("/tmp/a.ts");
    expect(ipc.fsRead).not.toHaveBeenCalledWith("/tmp/dirty.ts");
  });

  it("tracks dirty state and saves with optimistic hash", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/a.ts",
      content: "const x = 1;\n",
      hash: "h1",
      truncated: false,
      longLines: false,
      readOnly: false,
    });
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "h2" });

    await useEditorStore.getState().openFile("/tmp/a.ts");
    useEditorStore.getState().setContent("/tmp/a.ts", "const x = 2;\n");
    const dirty = useEditorStore.getState().tabs[0];
    expect(dirty?.content).not.toBe(dirty?.savedContent);

    await useEditorStore.getState().saveActive();
    expect(ipc.fsWrite).toHaveBeenCalledWith("/tmp/a.ts", "const x = 2;\n", "h1");
    const saved = useEditorStore.getState().tabs[0];
    expect(saved?.hash).toBe("h2");
    expect(saved?.savedContent).toBe("const x = 2;\n");
  });

  it("skips save when content is unchanged", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/b.ts",
      content: "ok",
      hash: "h",
      truncated: false,
      longLines: false,
      readOnly: false,
    });

    await useEditorStore.getState().openFile("/tmp/b.ts");
    await useEditorStore.getState().saveActive();
    expect(ipc.fsWrite).not.toHaveBeenCalled();
  });

  it("prompts before leaving a dirty tab and can discard the edit", async () => {
    useEditorStore.setState({
      activePath: "/tmp/a.ts",
      tabs: [
        {
          path: "/tmp/a.ts",
          name: "a.ts",
          content: "changed",
          savedContent: "original",
          hash: "h1",
          truncated: false,
          longLines: false,
          readOnly: false,
        },
        {
          path: "/tmp/b.ts",
          name: "b.ts",
          content: "other",
          savedContent: "other",
          hash: "h2",
          truncated: false,
          longLines: false,
          readOnly: false,
        },
      ],
    });

    const navigation = useEditorStore.getState().activateTab("/tmp/b.ts");
    expect(useUnsavedChangesStore.getState().pending?.name).toBe("a.ts");
    useUnsavedChangesStore.getState().decide("discard");
    await navigation;

    const state = useEditorStore.getState();
    expect(state.activePath).toBe("/tmp/b.ts");
    expect(state.tabs[0]?.content).toBe("original");
  });
});
