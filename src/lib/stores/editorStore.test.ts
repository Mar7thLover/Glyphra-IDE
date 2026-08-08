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
import {
  convertLineEndings,
  detectEol,
  isEditorTabDirty,
  isUntitledPath,
  normalizeEol,
  useEditorStore,
  type EditorTab,
} from "./editorStore";

const fileEncoding = { encoding: "UTF-8", bom: false, lossy: false };
const tabDefaults = {
  encoding: "UTF-8",
  savedEncoding: "UTF-8",
  bom: false,
  savedBom: false,
  eol: "LF" as const,
  savedEol: "LF" as const,
  lossy: false,
  truncated: false,
  longLines: false,
  readOnly: false,
};

function makeTab(overrides: Partial<EditorTab> & Pick<EditorTab, "path" | "name">): EditorTab {
  return {
    content: "",
    savedContent: "",
    hash: "",
    ...tabDefaults,
    ...overrides,
  };
}

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
      conflictPath: null,
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

  it("marks lossily decoded files read-only", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/mixed.log",
      content: "ok � line",
      hash: "l1",
      truncated: false,
      longLines: false,
      readOnly: true,
      encoding: "UTF-8",
      bom: false,
      lossy: true,
    });

    await useEditorStore.getState().openFile("/tmp/mixed.log");
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.lossy).toBe(true);
    expect(tab?.readOnly).toBe(true);
  });

  it("normalizes CRLF files to LF buffers and records the real line ending", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/win.txt",
      content: "a\r\nb\r\n",
      hash: "h1",
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    });

    await useEditorStore.getState().openFile("/tmp/win.txt");
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.content).toBe("a\nb\n");
    expect(tab?.savedContent).toBe("a\nb\n");
    expect(tab?.eol).toBe("CRLF");
    expect(isEditorTabDirty(tab!)).toBe(false);
  });

  it("converts the buffer back to CRLF at save time only", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/win.txt",
      content: "a\r\nb\r\n",
      hash: "h1",
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    });
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "h2" });

    await useEditorStore.getState().openFile("/tmp/win.txt");
    useEditorStore.getState().setContent("/tmp/win.txt", "a\nb\nc\n");
    await useEditorStore.getState().saveActive();

    expect(ipc.fsWrite).toHaveBeenCalledWith(
      "/tmp/win.txt",
      "a\r\nb\r\nc\r\n",
      "h1",
      "UTF-8",
      false,
    );
    const saved = useEditorStore.getState().tabs[0];
    // The store keeps the LF form so buffer and savedContent stay comparable.
    expect(saved?.savedContent).toBe("a\nb\nc\n");
    expect(saved?.eol).toBe("CRLF");
    expect(isEditorTabDirty(saved!)).toBe(false);
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

  it("does not create duplicate tabs when two opens race", async () => {
    vi.mocked(ipc.fsRead).mockImplementation(async (path: string) => ({
      path,
      content: "x\n",
      hash: `hash:${path}`,
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    }));

    await Promise.all([
      useEditorStore.getState().openFile("/tmp/a.ts", { preview: true }),
      useEditorStore.getState().openFile("/tmp/a.ts", { preview: false }),
    ]);
    expect(
      useEditorStore.getState().tabs.filter((tab) => tab.path === "/tmp/a.ts"),
    ).toHaveLength(1);
  });

  it("reloads clean tabs from disk on syncFromDisk", async () => {
    useEditorStore.setState({
      tabs: [
        makeTab({ path: "/tmp/a.ts", name: "a.ts", content: "old", savedContent: "old", hash: "h1" }),
        makeTab({
          path: "/tmp/dirty.ts",
          name: "dirty.ts",
          content: "local",
          savedContent: "disk",
          hash: "d1",
        }),
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

  it("serializes concurrent saves so only one write reaches disk", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/a.ts",
      content: "one\n",
      hash: "h1",
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    });
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "h2" });

    await useEditorStore.getState().openFile("/tmp/a.ts");
    useEditorStore.getState().setContent("/tmp/a.ts", "two\n");
    // Both fire in the same tick — the double Ctrl+S scenario. The second
    // save must observe the first one's result and skip the write.
    await Promise.all([
      useEditorStore.getState().saveTab("/tmp/a.ts"),
      useEditorStore.getState().saveTab("/tmp/a.ts"),
    ]);
    expect(ipc.fsWrite).toHaveBeenCalledTimes(1);
  });

  it("flags an optimistic-lock failure as a conflict instead of a plain error", async () => {
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/tmp/a.ts",
      content: "one\n",
      hash: "h1",
      truncated: false,
      longLines: false,
      readOnly: false,
      ...fileEncoding,
    });
    vi.mocked(ipc.fsWrite).mockRejectedValue(
      new Error("file changed on disk; reload before saving"),
    );

    await useEditorStore.getState().openFile("/tmp/a.ts");
    useEditorStore.getState().setContent("/tmp/a.ts", "two\n");
    const saved = await useEditorStore.getState().saveTab("/tmp/a.ts");
    expect(saved).toBe(false);
    const state = useEditorStore.getState();
    expect(state.conflictPath).toBe("/tmp/a.ts");
    expect(state.error).toBeNull();

    // Force-save overwrites without the hash and clears the conflict.
    vi.mocked(ipc.fsWrite).mockResolvedValue({ hash: "h3" });
    await useEditorStore.getState().saveTab("/tmp/a.ts", { force: true });
    expect(ipc.fsWrite).toHaveBeenLastCalledWith(
      "/tmp/a.ts",
      "two\n",
      undefined,
      "UTF-8",
      false,
    );
    expect(useEditorStore.getState().conflictPath).toBeNull();
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

  it("switches line endings as metadata without rewriting the buffer", () => {
    expect(convertLineEndings("a\r\nb\rc\n", "LF")).toBe("a\nb\nc\n");
    expect(convertLineEndings("a\nb\n", "CRLF")).toBe("a\r\nb\r\n");
    expect(normalizeEol("a\r\nb\rc\n")).toBe("a\nb\nc\n");
    expect(detectEol("a\r\nb")).toBe("CRLF");
    expect(detectEol("a\nb")).toBe("LF");

    useEditorStore.setState({
      tabs: [
        makeTab({ path: "/tmp/a.ts", name: "a.ts", content: "a\nb\n", savedContent: "a\nb\n", hash: "h1" }),
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
    // Buffer stays LF — only the save-time line ending changes.
    expect(state.tabs[0]?.content).toBe("a\nb\n");
    expect(state.tabs[0]?.eol).toBe("CRLF");
    expect(isEditorTabDirty(state.tabs[0]!)).toBe(true);
    expect(state.docInfo?.eol).toBe("CRLF");
  });

  it("bumps a revision on external edits so mounted views follow", () => {
    useEditorStore.setState({
      tabs: [
        makeTab({
          path: "/tmp/a.ts",
          name: "a.ts",
          content: "const value = 1;",
          savedContent: "const value = 1;",
          hash: "h1",
          ephemeral: true,
        }),
        makeTab({
          path: "/tmp/locked.ts",
          name: "locked.ts",
          content: "frozen",
          savedContent: "frozen",
          hash: "h2",
          readOnly: true,
        }),
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
      lossy: false,
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

  it("switches tabs freely without prompting for dirty buffers", () => {
    useEditorStore.setState({
      activePath: "/tmp/a.ts",
      primaryPath: "/tmp/a.ts",
      tabs: [
        makeTab({ path: "/tmp/a.ts", name: "a.ts", content: "changed", savedContent: "original", hash: "h1" }),
        makeTab({ path: "/tmp/b.ts", name: "b.ts", content: "other", savedContent: "other", hash: "h2" }),
      ],
    });

    useEditorStore.getState().activateTab("/tmp/b.ts");
    const state = useEditorStore.getState();
    expect(useUnsavedChangesStore.getState().pending).toBeNull();
    expect(state.activePath).toBe("/tmp/b.ts");
    // The dirty buffer survives the switch untouched.
    expect(state.tabs[0]?.content).toBe("changed");
  });

  it("prompts before closing a dirty tab and can discard the edit", async () => {
    useEditorStore.setState({
      activePath: "/tmp/a.ts",
      primaryPath: "/tmp/a.ts",
      tabs: [
        makeTab({ path: "/tmp/a.ts", name: "a.ts", content: "changed", savedContent: "original", hash: "h1" }),
      ],
    });

    const closing = useEditorStore.getState().closeTab("/tmp/a.ts");
    await vi.waitFor(() => {
      expect(useUnsavedChangesStore.getState().pending?.name).toBe("a.ts");
    });
    useUnsavedChangesStore.getState().decide("discard");
    await closing;

    expect(useEditorStore.getState().tabs).toHaveLength(0);
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

  it("never reuses the index of a restored untitled buffer", () => {
    useEditorStore.setState({
      tabs: [
        makeTab({ path: "untitled://7", name: "Untitled-7", content: "recovered", savedContent: "" }),
      ],
    });
    useEditorStore.getState().newUntitled();
    const paths = useEditorStore.getState().tabs.map((tab) => tab.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("untitled://8");
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
