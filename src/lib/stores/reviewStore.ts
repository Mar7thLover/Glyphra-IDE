import { create } from "zustand";

import { ipc, type CkptFileContents, type CkptTurnMeta } from "@/lib/ipc/ipc";

interface ReviewState {
  turns: CkptTurnMeta[];
  activeTurnId: string | null;
  activeFile: string | null;
  contents: CkptFileContents | null;
  open: boolean;
  loading: boolean;
  error: string | null;
  ingestTurn: (turn: CkptTurnMeta) => void;
  refresh: (projectPath: string) => Promise<void>;
  openReview: () => void;
  closeReview: () => void;
  selectTurn: (projectPath: string, turnId: string) => Promise<void>;
  selectFile: (projectPath: string, turnId: string, path: string) => Promise<void>;
  restoreTurn: (projectPath: string, turnId: string) => Promise<void>;
  restoreFile: (projectPath: string, turnId: string, path: string) => Promise<void>;
  acceptFile: (projectPath: string, turnId: string, path: string) => Promise<void>;
  writeMerged: (projectPath: string, path: string, content: string) => Promise<void>;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  turns: [],
  activeTurnId: null,
  activeFile: null,
  contents: null,
  open: false,
  loading: false,
  error: null,

  ingestTurn: (turn) => {
    if (turn.files.length === 0) return;
    set((state) => ({
      turns: [turn, ...state.turns.filter((item) => item.id !== turn.id)],
      activeTurnId: turn.id,
      activeFile: turn.files[0]?.path ?? null,
      open: true,
      contents: null,
    }));
    const projectPath = turn.projectPath;
    const file = turn.files[0]?.path;
    if (file) void get().selectFile(projectPath, turn.id, file);
  },

  refresh: async (projectPath) => {
    try {
      const turns = await ipc.ckptListTurns(projectPath);
      set({ turns, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  openReview: () => set({ open: true }),
  closeReview: () => set({ open: false }),

  selectTurn: async (projectPath, turnId) => {
    const turn = get().turns.find((item) => item.id === turnId);
    set({ activeTurnId: turnId, activeFile: turn?.files[0]?.path ?? null, contents: null });
    const file = turn?.files[0]?.path;
    if (file) await get().selectFile(projectPath, turnId, file);
  },

  selectFile: async (projectPath, turnId, path) => {
    set({ loading: true, activeFile: path, error: null });
    try {
      const contents = await ipc.ckptFileContents(projectPath, turnId, path);
      set({ contents, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  restoreTurn: async (projectPath, turnId) => {
    set({ loading: true, error: null });
    try {
      await ipc.ckptRestoreTurn(projectPath, turnId);
      set({ loading: false, contents: null });
      await get().refresh(projectPath);
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  restoreFile: async (projectPath, turnId, path) => {
    set({ loading: true, error: null });
    try {
      await ipc.ckptRestoreFile(projectPath, turnId, path);
      const contents = await ipc.ckptFileContents(projectPath, turnId, path);
      set({ contents, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  acceptFile: async (projectPath, turnId, path) => {
    // Keep current after content — just clear from active review focus.
    set({ loading: true, error: null });
    try {
      const contents = await ipc.ckptFileContents(projectPath, turnId, path);
      await ipc.ckptWriteFile(projectPath, path, contents.after);
      set({ loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  writeMerged: async (projectPath, path, content) => {
    await ipc.ckptWriteFile(projectPath, path, content);
    const turnId = get().activeTurnId;
    if (turnId) {
      const contents = await ipc.ckptFileContents(projectPath, turnId, path);
      set({ contents: { ...contents, after: content } });
    }
  },
}));
