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
    dirname: vi.fn<(path: string) => Promise<string>>(),
    projectState,
    editorState,
    agentState: {
      liveSessions: [] as Array<{ projectPath: string; archiveId: string }>,
      closeLiveSession: vi.fn(),
    },
  };
});

vi.mock("@tauri-apps/api/path", () => ({ dirname: mocks.dirname }));
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
  useUiStore: { getState: () => ({ setAgentOpen: vi.fn(), closeSettings: vi.fn() }) },
}));

import { openFilePath, openProjectPath } from "./workspaceActions";

describe("workspaceActions", () => {
  beforeEach(() => {
    mocks.projectState.current = null;
    mocks.projectState.openProject.mockReset();
    mocks.projectState.closeProject.mockReset();
    mocks.editorState.tabs = [];
    mocks.editorState.openFile.mockReset();
    mocks.dirname.mockReset();
    mocks.agentState.liveSessions = [];
    mocks.agentState.closeLiveSession.mockReset();
  });

  it("opens a selected file in the existing IDE window", async () => {
    mocks.dirname.mockResolvedValue("C:\\work");
    mocks.projectState.openProject.mockImplementation(async (path) => {
      mocks.projectState.current = { path: `\\\\?\\${path}`, name: "work" };
    });
    mocks.editorState.openFile.mockImplementation(async (path) => {
      mocks.editorState.tabs.push({ path });
    });

    await expect(openFilePath("C:\\work\\note.ts", "unsaved")).resolves.toBe(true);

    expect(mocks.projectState.openProject).toHaveBeenCalledWith("C:\\work");
    expect(mocks.editorState.openFile).toHaveBeenCalledWith("C:\\work\\note.ts");
  });

  it("opens a project directly in the current window state", async () => {
    mocks.projectState.openProject.mockImplementation(async (path) => {
      mocks.projectState.current = { path, name: "other" };
    });

    await expect(openProjectPath("C:\\other", "unsaved")).resolves.toBe(true);

    expect(mocks.projectState.openProject).toHaveBeenCalledWith("C:\\other");
  });
});
