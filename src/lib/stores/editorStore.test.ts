import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    fsMediaPreview: vi.fn(),
    fsRead: vi.fn(),
    fsWrite: vi.fn(),
    editorConfigResolve: vi.fn(),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "@/lib/ipc/ipc";
import { useUnsavedChangesStore } from "@/lib/unsavedChanges";
import { convertLineEndings, isUntitledPath, useEditorStore } from "./editorStore";

const fileEncoding = { encoding: "UTF-8", bom: false };
const tabEncoding = {
  encoding: "UTF-8",
  savedEncoding: "UTF-8",
  bom: false,
  savedBom: false,
};

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activePath: null,
      primaryPath: null,
      secondaryPath: null,
      focusedPane: "primary",
      loading: false,
      error: null,
      reveal: null,
      cursor: null,
      docInfo: null,
      recoveryNotice: null,
    });
    vi.mocked(ipc.fsRead).mockReset();
    vi.mocked(ipc.fsWrite).mockReset();
    vi.mocked(ipc.fsMediaPreview).mockReset();
    vi.mocked(ipc.editorConfigResolve).mockReset();
    vi.mocked(saveDialog).mockReset();
    vi.mocked(ipc.fsMediaPreview).mockResolvedValue(null);
    vi.mocked(ipc.editorConfigResolve).mockResolvedValue({
      sourceFiles: [],
      indentStyle: null,
      indentSize: null,
      tabWidth: null,
      endOfLine: null,
      charset: null,
      trimTrailingWhitespace: null,
      insertFinalNewline: null,
      maxLineLength: null,
      quoteType: null,
      spellingLanguage: null,
    });
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
      ...fileEncoding,
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
      ...fileEncoding,
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
          ...tabEncoding,
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
          ...tabEncoding,
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
          ...fileEncoding,
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
      ...fileEncoding,
    });
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "h2" });

    await useEditorStore.getState().openFile("/tmp/a.ts");
    useEditorStore.getState().setContent("/tmp/a.ts", "const x = 2;\n");
    const dirty = useEditorStore.getState().tabs[0];
    expect(dirty?.content).not.toBe(dirty?.savedContent);

    await useEditorStore.getState().saveActive();
    expect(ipc.fsWrite).toHaveBeenCalledWith(
      "/tmp/a.ts",
      "const x = 2;\n",
      "h1",
      "UTF-8",
      false,
    );
    const saved = useEditorStore.getState().tabs[0];
    expect(saved?.hash).toBe("h2");
    expect(saved?.savedContent).toBe("const x = 2;\n");
  });

  it("opens binary and media files as previews without reading them as text", async () => {
    vi.mocked(ipc.fsMediaPreview).mockResolvedValue({
      path: "/tmp/logo.png",
      kind: "image",
      mime: "image/png",
      size: 128,
      dataUrl: "data:image/png;base64,AAAA",
    });

    await useEditorStore.getState().openFile("/tmp/logo.png");
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.preview?.kind).toBe("image");
    expect(tab?.readOnly).toBe(true);
    expect(ipc.fsRead).not.toHaveBeenCalled();
  });

  it("replaces unpinned explorer previews and supports split/reorder", async () => {
    vi.mocked(ipc.fsRead).mockImplementation(async (path: string) => ({
      path,
      content: `${path}\n`,
      hash: `hash:${path}`,
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    }));

    await useEditorStore.getState().openFile("/tmp/a.ts", { preview: true });
    await useEditorStore.getState().openFile("/tmp/b.ts", { preview: true });
    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual(["/tmp/b.ts"]);

    useEditorStore.getState().pinTab("/tmp/b.ts");
    await useEditorStore.getState().openFile("/tmp/c.ts", { preview: true });
    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual([
      "/tmp/b.ts",
      "/tmp/c.ts",
    ]);

    useEditorStore.getState().splitActive();
    expect(useEditorStore.getState().secondaryPath).toBe("/tmp/b.ts");
    useEditorStore.getState().reorderTabs("/tmp/c.ts", "/tmp/b.ts");
    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual([
      "/tmp/c.ts",
      "/tmp/b.ts",
    ]);
    useEditorStore.getState().closeSplit();
    expect(useEditorStore.getState().secondaryPath).toBeNull();
  });

  it("converts line endings and marks the buffer dirty", () => {
    expect(convertLineEndings("a\r\nb\rc\n", "LF")).toBe("a\nb\nc\n");
    expect(convertLineEndings("a\nb\n", "CRLF")).toBe("a\r\nb\r\n");

    useEditorStore.setState({
      tabs: [
        {
          path: "/tmp/a.ts",
          name: "a.ts",
          content: "a\nb\n",
          savedContent: "a\nb\n",
          ...tabEncoding,
          hash: "h1",
          truncated: false,
          longLines: false,
          readOnly: false,
        },
      ],
      activePath: "/tmp/a.ts",
      docInfo: {
        languageName: "TypeScript",
        eol: "LF",
        indentStyle: "space",
        indentSize: 2,
        editorConfigIndent: false,
      },
    });

    useEditorStore.getState().setLineEnding("/tmp/a.ts", "CRLF");
    const state = useEditorStore.getState();
    expect(state.tabs[0]?.content).toBe("a\r\nb\r\n");
    expect(state.tabs[0]?.content).not.toBe(state.tabs[0]?.savedContent);
    expect(state.docInfo?.eol).toBe("CRLF");
  });

  it("bumps a revision on external edits so mounted views follow", () => {
    useEditorStore.setState({
      tabs: [
        {
          path: "/tmp/a.ts",
          name: "a.ts",
          content: "const value = 1;",
          savedContent: "const value = 1;",
          ...tabEncoding,
          hash: "h1",
          truncated: false,
          longLines: false,
          readOnly: false,
          ephemeral: true,
        },
        {
          path: "/tmp/locked.ts",
          name: "locked.ts",
          content: "frozen",
          savedContent: "frozen",
          ...tabEncoding,
          hash: "h2",
          truncated: false,
          longLines: false,
          readOnly: true,
        },
      ],
    });

    useEditorStore.getState().applyExternalEdit("/tmp/a.ts", "const total = 1;");
    const [edited, locked] = useEditorStore.getState().tabs;
    expect(edited?.content).toBe("const total = 1;");
    expect(edited?.revision).toBe(1);
    // The hash still describes what is on disk, so the optimistic-lock save
    // keeps working after an external rewrite.
    expect(edited?.hash).toBe("h1");
    expect(edited?.ephemeral).toBe(false);

    // No revision churn when nothing actually changed.
    useEditorStore.getState().applyExternalEdit("/tmp/a.ts", "const total = 1;");
    expect(useEditorStore.getState().tabs[0]?.revision).toBe(1);

    useEditorStore.getState().applyExternalEdit("/tmp/locked.ts", "thawed");
    expect(locked?.content).toBe("frozen");
    expect(useEditorStore.getState().tabs[1]?.content).toBe("frozen");
  });

  it("skips save when content is unchanged", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/b.ts",
      content: "ok\n",
      hash: "h",
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    });

    await useEditorStore.getState().openFile("/tmp/b.ts");
    await useEditorStore.getState().saveActive();
    expect(ipc.fsWrite).not.toHaveBeenCalled();
  });

  it("converts encoding on save even when text is unchanged", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/legacy.txt",
      content: "café\n",
      hash: "legacy-hash",
      truncated: false,
      longLines: false,
      readOnly: false,
      encoding: "windows-1252",
      bom: false,
    });
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "utf8-hash" });

    await useEditorStore.getState().openFile("/tmp/legacy.txt");
    useEditorStore.getState().setEncoding("/tmp/legacy.txt", "UTF-8");
    await useEditorStore.getState().saveActive();

    expect(ipc.fsWrite).toHaveBeenCalledWith(
      "/tmp/legacy.txt",
      "café\n",
      "legacy-hash",
      "UTF-8",
      false,
    );
    expect(useEditorStore.getState().tabs[0]?.savedEncoding).toBe("UTF-8");
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
          ...tabEncoding,
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
          ...tabEncoding,
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

  it("creates an untitled buffer without touching disk", () => {
    useEditorStore.getState().newUntitled();
    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(isUntitledPath(state.tabs[0]!.path)).toBe(true);
    expect(state.tabs[0]!.name).toMatch(/^Untitled-/);
    expect(state.tabs[0]!.content).toBe("");
    expect(state.tabs[0]!.readOnly).toBe(false);
    expect(state.activePath).toBe(state.tabs[0]!.path);
  });

  it("saves an untitled buffer through a Save As dialog and remaps the tab", async () => {
    vi.mocked(saveDialog).mockResolvedValue("/tmp/out.txt");
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "saved-hash" });

    useEditorStore.getState().newUntitled();
    const untitledPath = useEditorStore.getState().tabs[0]!.path;
    useEditorStore.setState({ tabs: [{ ...useEditorStore.getState().tabs[0]!, content: "hello" }] });

    const saved = await useEditorStore.getState().saveTab(untitledPath);
    expect(saved).toBe(true);
    expect(saveDialog).toHaveBeenCalledOnce();
    expect(ipc.fsWrite).toHaveBeenCalledWith(
      "/tmp/out.txt",
      "hello\n",
      undefined,
      "UTF-8",
      false,
    );
    const state = useEditorStore.getState();
    expect(state.tabs[0]!.path).toBe("/tmp/out.txt");
    expect(state.tabs[0]!.name).toBe("out.txt");
    expect(state.tabs[0]!.savedContent).toBe("hello\n");
    expect(state.activePath).toBe("/tmp/out.txt");
  });

  it("keeps an untitled buffer untitled when Save As is cancelled", async () => {
    vi.mocked(saveDialog).mockResolvedValue(null);
    useEditorStore.getState().newUntitled();
    const untitledPath = useEditorStore.getState().tabs[0]!.path;
    useEditorStore.setState({ tabs: [{ ...useEditorStore.getState().tabs[0]!, content: "draft" }] });

    const saved = await useEditorStore.getState().saveTab(untitledPath);
    expect(saved).toBe(false);
    expect(ipc.fsWrite).not.toHaveBeenCalled();
    expect(isUntitledPath(useEditorStore.getState().tabs[0]!.path)).toBe(true);
  });
});
