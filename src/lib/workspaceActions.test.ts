import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectState = {
    current: null as { path: string; name: string } | null,
    roots: [] as Array<{ path: string; name: string }>,
    openWorkspace: vi.fn<(paths: string[]) => Promise<void>>(),
    closeProject: vi.fn<() => Promise<void>>(),
  };
  const editorState = {
    tabs: [] as Array<{ path: string; dirty?: boolean }>,
    openFile: vi.fn<(path: string) => Promise<void>>(),
    saveTab: vi.fn<(path: string) => Promise<boolean>>(),
  };
  return {
    projectState,
    editorState,
    agentState: {
      liveSessions: [] as Array<{ projectPath: string; archiveId: string }>,
      closeLiveSession: vi.fn(),
    },
    uiState: {
      setAgentOpen: vi.fn(),
      showWorkspace: vi.fn(),
      closeSettings: vi.fn(),
    },
    persistEditorRecovery: vi.fn(async () => true),
    requestUnsavedDecision: vi.fn(async () => "discard" as const),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/lib/editorRecovery", () => ({
  persistEditorRecovery: mocks.persistEditorRecovery,
}));
vi.mock("@/lib/unsavedChanges", () => ({
  requestUnsavedDecision: mocks.requestUnsavedDecision,
}));
vi.mock("@/lib/stores/agentStore", () => ({
  useAgentStore: { getState: () => mocks.agentState },
}));
vi.mock("@/lib/stores/editorStore", () => ({
  isEditorTabDirty: (tab: { dirty?: boolean }) => Boolean(tab.dirty),
  useEditorStore: { getState: () => mocks.editorState },
}));
vi.mock("@/lib/stores/projectStore", () => ({
  useProjectStore: { getState: () => mocks.projectState },
}));
vi.mock("@/lib/stores/terminalStore", () => ({
  useTerminalStore: { getState: () => ({ setOpen: vi.fn() }) },
}));
vi.mock("@/lib/stores/uiStore", () => ({
  useUiStore: { getState: () => mocks.uiState },
}));

import { openFilePath, openProjectPath } from "./workspaceActions";

describe("workspaceActions", () => {
  beforeEach(() => {
    mocks.projectState.current = null;
    mocks.projectState.roots = [];
    mocks.projectState.openWorkspace.mockReset();
    mocks.projectState.closeProject.mockReset();
    mocks.editorState.tabs = [];
    mocks.editorState.openFile.mockReset();
    mocks.editorState.saveTab.mockReset();
    mocks.agentState.liveSessions = [];
    mocks.agentState.closeLiveSession.mockReset();
    mocks.uiState.setAgentOpen.mockReset();
    mocks.uiState.showWorkspace.mockReset();
    mocks.uiState.closeSettings.mockReset();
    mocks.persistEditorRecovery.mockClear();
    mocks.requestUnsavedDecision.mockClear();
  });

  it("opens a selected file in the existing IDE window", async () => {
    mocks.editorState.openFile.mockImplementation(async (path) => {
      mocks.editorState.tabs.push({ path });
    });

    await expect(openFilePath("C:\\work\\note.ts")).resolves.toBe(true);

    expect(mocks.projectState.openWorkspace).not.toHaveBeenCalled();
    expect(mocks.projectState.current).toBeNull();
    expect(mocks.editorState.openFile).toHaveBeenCalledWith("C:\\work\\note.ts");
    expect(mocks.uiState.showWorkspace).toHaveBeenCalledWith("editor");
  });

  it("keeps an existing project open when a loose file is opened", async () => {
    mocks.projectState.current = { path: "C:\\repo", name: "repo" };
    mocks.editorState.openFile.mockImplementation(async (path) => {
      mocks.editorState.tabs.push({ path });
    });

    await expect(openFilePath("C:\\notes\\todo.md")).resolves.toBe(true);

    expect(mocks.projectState.current?.path).toBe("C:\\repo");
    expect(mocks.projectState.openWorkspace).not.toHaveBeenCalled();
    expect(mocks.projectState.closeProject).not.toHaveBeenCalled();
  });

  it("opens a project directly in the current window state", async () => {
    mocks.projectState.openWorkspace.mockImplementation(async (paths) => {
      mocks.projectState.current = { path: paths[0]!, name: "other" };
      mocks.projectState.roots = paths.map((path) => ({ path, name: "other" }));
    });

    await expect(openProjectPath("C:\\other")).resolves.toBe(true);

    expect(mocks.projectState.openWorkspace).toHaveBeenCalledWith(["C:\\other"]);
  });

  it("snapshots dirty buffers into recovery before switching projects", async () => {
    mocks.projectState.current = { path: "C:\\repo", name: "repo" };
    mocks.editorState.tabs = [{ path: "C:\\repo\\a.ts", dirty: true }];
    mocks.projectState.openWorkspace.mockImplementation(async (paths) => {
      mocks.projectState.current = { path: paths[0]!, name: "next" };
      mocks.projectState.roots = paths.map((path) => ({ path, name: "next" }));
    });

    await expect(openProjectPath("C:\\next")).resolves.toBe(true);

    expect(mocks.persistEditorRecovery).toHaveBeenCalledWith("C:\\repo");
    // No blocking prompt in project mode — hot-exit semantics.
    expect(mocks.requestUnsavedDecision).not.toHaveBeenCalled();
  });

  it("asks per dirty loose file when no project is open", async () => {
    mocks.editorState.tabs = [{ path: "C:\\notes\\a.md", dirty: true }];
    mocks.projectState.openWorkspace.mockImplementation(async (paths) => {
      mocks.projectState.current = { path: paths[0]!, name: "next" };
      mocks.projectState.roots = paths.map((path) => ({ path, name: "next" }));
    });

    await expect(openProjectPath("C:\\next")).resolves.toBe(true);

    expect(mocks.persistEditorRecovery).not.toHaveBeenCalled();
    expect(mocks.requestUnsavedDecision).toHaveBeenCalledTimes(1);
  });

  it("aborts the project switch when the user cancels", async () => {
    mocks.editorState.tabs = [{ path: "C:\\notes\\a.md", dirty: true }];
    mocks.requestUnsavedDecision.mockResolvedValueOnce("cancel" as never);

    await expect(openProjectPath("C:\\next")).resolves.toBe(false);
    expect(mocks.projectState.openWorkspace).not.toHaveBeenCalled();
  });
});
