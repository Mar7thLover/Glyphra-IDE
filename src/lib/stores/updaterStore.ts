import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { create } from "zustand";

import { ipc } from "@/lib/ipc/ipc";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  notes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  checkForUpdate: (silent?: boolean) => Promise<void>;
  download: () => Promise<void>;
  installAndRestart: () => Promise<void>;
  dismiss: () => void;
}

let pendingUpdate: Update | null = null;

export function nextDownloadProgress(
  event: DownloadEvent,
  downloadedBytes: number,
  totalBytes: number | null,
) {
  if (event.event === "Started") {
    return {
      downloadedBytes: 0,
      totalBytes: event.data.contentLength ?? null,
    };
  }
  if (event.event === "Progress") {
    return {
      downloadedBytes: downloadedBytes + event.data.chunkLength,
      totalBytes,
    };
  }
  return { downloadedBytes, totalBytes };
}

async function releasePendingUpdate() {
  const update = pendingUpdate;
  pendingUpdate = null;
  if (update) await update.close().catch(() => undefined);
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,

  checkForUpdate: async (silent = false) => {
    if (["checking", "downloading", "installing"].includes(get().status)) return;
    await releasePendingUpdate();
    set({
      status: "checking",
      version: null,
      notes: null,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });
    try {
      const update = await check({ timeout: 15_000 });
      if (!update) {
        set({ status: silent ? "idle" : "up-to-date" });
        return;
      }
      pendingUpdate = update;
      set({
        status: "available",
        version: update.version,
        notes: update.body ?? null,
      });
    } catch (error) {
      if (silent) {
        set({ status: "idle" });
        return;
      }
      set({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  download: async () => {
    const update = pendingUpdate;
    if (!update || get().status !== "available") return;
    set({
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });
    try {
      await update.download((event) => {
        const state = get();
        set(nextDownloadProgress(event, state.downloadedBytes, state.totalBytes));
      });
      set({ status: "downloaded" });
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  installAndRestart: async () => {
    const update = pendingUpdate;
    if (!update || get().status !== "downloaded") return;
    set({ status: "installing", error: null });
    try {
      await ipc.appPrepareRestart();
      await update.install();
      await relaunch();
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  dismiss: () => {
    void releasePendingUpdate();
    set({
      status: "idle",
      version: null,
      notes: null,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
    });
  },
}));
