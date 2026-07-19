import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    fsRead: vi.fn(),
    fsWrite: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "./editorStore";

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activePath: null,
      loading: false,
      error: null,
    });
    vi.mocked(ipc.fsRead).mockReset();
    vi.mocked(ipc.fsWrite).mockReset();
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
});
