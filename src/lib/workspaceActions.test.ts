import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectState = {
    current: null as { path: string; name: string } | null,
    openProject: vi.fn<(path: string) => Promise<void>>(),
    closeProject: vi.fn<() => Promise<void>>(),
  };
  const editorState = {
    tabs: [] as Array<{ path: string; dirty?: boolean }>,
    openFile: vi.fn<(path: string) => Promise<void>>(),
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
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
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
    mocks.projectState.openProject.mockReset();
    mocks.projectState.closeProject.mockReset();
    mocks.editorState.tabs = [];
    mocks.editorState.openFile.mockReset();
    mocks.agentState.liveSessions = [];
    mocks.agentState.closeLiveSession.mockReset();
    mocks.uiState.setAgentOpen.mockReset();
    mocks.uiState.showWorkspace.mockReset();
    mocks.uiState.closeSettings.mockReset();
  });

  it("opens a selected file in the existing IDE window", async () => {
    mocks.editorState.openFile.mockImplementation(async (path) => {
      mocks.editorState.tabs.push({ path });
    });

    await expect(openFilePath("C:\\work\\note.ts", "unsaved")).resolves.toBe(true);

    expect(mocks.projectState.openProject).not.toHaveBeenCalled();
    expect(mocks.projectState.current).toBeNull();
    expect(mocks.editorState.openFile).toHaveBeenCalledWith("C:\\work\\note.ts");
    expect(mocks.uiState.showWorkspace).toHaveBeenCalledWith("editor");
  });

  it("keeps an existing project open when a loose file is opened", async () => {
    mocks.projectState.current = { path: "C:\\repo", name: "repo" };
    mocks.editorState.openFile.mockImplementation(async (path) => {
      mocks.editorState.tabs.push({ path });
    });

    await expect(openFilePath("C:\\notes\\todo.md", "unsaved")).resolves.toBe(true);

    expect(mocks.projectState.current?.path).toBe("C:\\repo");
    expect(mocks.projectState.openProject).not.toHaveBeenCalled();
    expect(mocks.projectState.closeProject).not.toHaveBeenCalled();
  });

  it("opens a project directly in the current window state", async () => {
    mocks.projectState.openProject.mockImplementation(async (path) => {
      mocks.projectState.current = { path, name: "other" };
    });

    await expect(openProjectPath("C:\\other", "unsaved")).resolves.toBe(true);

    expect(mocks.projectState.openProject).toHaveBeenCalledWith("C:\\other");
  });
});
