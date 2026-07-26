import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc/ipc", () => ({
  ipc: {
    editorRecoverySave: vi.fn(),
    editorRecoveryLoad: vi.fn(),
    editorRecoveryClear: vi.fn(),
    fsRead: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc/ipc";
import { createRecoverySnapshot, persistEditorRecovery, restoreEditorRecovery } from "./editorRecovery";
import { useEditorStore, type EditorTab } from "./stores/editorStore";

const utf8 = {
  encoding: "UTF-8",
  savedEncoding: "UTF-8",
  bom: false,
  savedBom: false,
};

const cleanTab: EditorTab = {
  path: "/repo/a.ts",
  name: "a.ts",
  content: "disk",
  savedContent: "disk",
  hash: "h1",
  truncated: false,
  longLines: false,
  readOnly: false,
  ...utf8,
};

describe("editor recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("snapshots only dirty tabs and retains their base hash", () => {
    const dirty = { ...cleanTab, content: "unsaved" };
    const snapshot = createRecoverySnapshot("/repo", [cleanTab, dirty], dirty.path, 42);

    expect(snapshot).toEqual({
      projectPath: "/repo",
      activePath: "/repo/a.ts",
      savedAt: 42,
      tabs: [
        {
          path: "/repo/a.ts",
          content: "unsaved",
          baseHash: "h1",
          encoding: "UTF-8",
          bom: false,
        },
      ],
    });
  });

  it("persists dirty buffers and clears the snapshot after they are clean", async () => {
    useEditorStore.setState({ tabs: [{ ...cleanTab, content: "unsaved" }] });
    await expect(persistEditorRecovery("/repo")).resolves.toBe(true);
    expect(ipc.editorRecoverySave).toHaveBeenCalledOnce();

    useEditorStore.setState({ tabs: [cleanTab] });
    await expect(persistEditorRecovery("/repo")).resolves.toBe(true);
    expect(ipc.editorRecoveryClear).toHaveBeenCalledWith("/repo");
  });

  it("restores content against the current disk version and flags conflicts", async () => {
    vi.mocked(ipc.editorRecoveryLoad).mockResolvedValue({
      projectPath: "/repo",
      activePath: "/repo/a.ts",
      savedAt: 42,
      tabs: [
        {
          path: "/repo/a.ts",
          content: "recovered",
          baseHash: "old-hash",
          encoding: "UTF-8",
          bom: false,
        },
      ],
    });
    vi.mocked(ipc.fsRead).mockResolvedValue({
      path: "/repo/a.ts",
      content: "new disk",
      hash: "new-hash",
      truncated: false,
      longLines: false,
      readOnly: false,
      encoding: "UTF-8",
      bom: false,
    });

    await expect(restoreEditorRecovery("/repo")).resolves.toBe(1);
    const state = useEditorStore.getState();
    expect(state.tabs[0]?.content).toBe("recovered");
    expect(state.tabs[0]?.savedContent).toBe("new disk");
    expect(state.tabs[0]?.hash).toBe("new-hash");
    expect(state.recoveryNotice).toEqual({ count: 1, conflicts: 1, savedAt: 42 });
  });
});
