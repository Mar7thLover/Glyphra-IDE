import { create } from "zustand";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

import { flushPendingEditorChanges } from "@/lib/editorCommands";
import {
  ipc,
  type EditorConfigSettings,
  type MediaPreviewResult,
} from "@/lib/ipc/ipc";
import { prepareContentForSave } from "@/lib/saveHygiene";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { requestUnsavedDecision } from "@/lib/unsavedChanges";

export type EditorEol = "LF" | "CRLF";

/**
 * Buffer contents are always LF-normalized in this store and in mounted
 * CodeMirror views. The file's real line ending lives in `eol` and is applied
 * once, at write time. Keeping a per-document CodeMirror `lineSeparator`
 * instead proved disastrous: pasted text is only split on the configured
 * separator, so pasting LF text into a CRLF file (or vice versa) produced
 * mixed endings, mega-lines and a full editor remount that destroyed the
 * undo history.
 */
export interface EditorTab {
  path: string;
  name: string;
  /** LF-normalized buffer contents. */
  content: string;
  /** LF-normalized contents of the last read/write. */
  savedContent: string;
  hash: string;
  truncated: boolean;
  longLines: boolean;
  readOnly: boolean;
  /** Decoded with replacement characters — saving would destroy the original bytes. */
  lossy: boolean;
  encoding: string;
  savedEncoding: string;
  bom: boolean;
  savedBom: boolean;
  eol: EditorEol;
  savedEol: EditorEol;
  editorConfig?: EditorConfigSettings | null;
  /**
   * Bumped whenever something other than the editor itself rewrites the buffer
   * (an LSP rename, for instance). A mounted CodeMirror view watches this to
   * pull the new text in — `hash` cannot serve that role because it is the
   * on-disk hash the optimistic-lock save depends on.
   */
  revision?: number;
  /** Single-click explorer tabs are replaced until edited, pinned, or double-clicked. */
  ephemeral?: boolean;
  preview?: MediaPreviewResult | null;
}

/** Synthetic path prefix for unsaved `Ctrl+N` buffers. */
export const UNTITLED_PREFIX = "untitled://";

export function isUntitledPath(path: string): boolean {
  return path.startsWith(UNTITLED_PREFIX);
}

export function untitledLabel(path: string): string {
  const index = path.slice(UNTITLED_PREFIX.length);
  return `Untitled-${index || "1"}`;
}

export const TEXT_ENCODINGS = [
  "UTF-8",
  "UTF-16LE",
  "UTF-16BE",
  "windows-1252",
  "GBK",
  "Big5",
  "Shift_JIS",
  "EUC-KR",
  "ISO-8859-2",
] as const;

export function detectEol(content: string): EditorEol {
  return content.includes("\r\n") ? "CRLF" : "LF";
}

export function normalizeEol(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function convertLineEndings(content: string, eol: EditorEol): string {
  return content.replace(/\r\n|\r|\n/g, eol === "CRLF" ? "\r\n" : "\n");
}

export function isEditorTabDirty(tab: EditorTab): boolean {
  return (
    tab.content !== tab.savedContent ||
    tab.encoding !== tab.savedEncoding ||
    tab.bom !== tab.savedBom ||
    tab.eol !== tab.savedEol
  );
}

/** Live caret of the active editor, surfaced in the status bar. */
export interface EditorCursor {
  line: number;
  col: number;
  selChars: number;
}

/** Per-document info the editor reports so the status bar avoids pulling in
 * the heavy language-data bundle itself. */
export interface EditorDocInfo {
  languageName: string | null;
  eol: EditorEol;
  indentStyle: "space" | "tab";
  indentSize: number;
  /** True when the effective indentation comes from one or more .editorconfig files. */
  editorConfigIndent: boolean;
}

export interface EditorRecoveryNotice {
  count: number;
  conflicts: number;
  savedAt: number;
}

export interface OpenFileOptions {
  /** 1-based line to reveal after open. */
  line?: number;
  /** 1-based column (defaults to 1). */
  column?: number;
  /** Force re-read from disk even if the tab is already open (clean tabs only). */
  reload?: boolean;
  /** Open as a replaceable preview tab. */
  preview?: boolean;
}

export interface SaveTabOptions {
  /** Skip the optimistic disk-hash check and overwrite whatever is on disk. */
  force?: boolean;
}

export interface EditorReveal {
  path: string;
  line: number;
  column: number;
  token: number;
}

interface EditorState {
  tabs: EditorTab[];
  activePath: string | null;
  primaryPath: string | null;
  secondaryPath: string | null;
  focusedPane: "primary" | "secondary";
  loading: boolean;
  error: string | null;
  /** Path whose last save hit the optimistic lock (file changed on disk). */
  conflictPath: string | null;
  reveal: EditorReveal | null;
  cursor: EditorCursor | null;
  docInfo: EditorDocInfo | null;
  recoveryNotice: EditorRecoveryNotice | null;
  openFile: (path: string, options?: OpenFileOptions) => Promise<void>;
  newUntitled: () => void;
  activateTab: (path: string) => void;
  focusPane: (pane: "primary" | "secondary") => void;
  splitActive: () => void;
  closeSplit: () => void;
  reorderTabs: (sourcePath: string, targetPath: string) => void;
  pinTab: (path: string) => void;
  closeTab: (path: string) => Promise<void>;
  setContent: (path: string, content: string) => void;
  /** Rewrite a buffer from outside the editor and make mounted views follow. */
  applyExternalEdit: (path: string, content: string) => void;
  setLineEnding: (path: string, eol: EditorEol) => void;
  setEncoding: (path: string, encoding: string) => void;
  reopenWithEncoding: (path: string, encoding: string) => Promise<void>;
  saveTab: (path: string, options?: SaveTabOptions) => Promise<boolean>;
  saveActive: () => Promise<void>;
  /** Reload clean open tabs whose paths appear in `paths` (absolute). */
  syncFromDisk: (paths: string[]) => Promise<void>;
  /** Replace one open tab from disk after a controlled checkpoint write. */
  refreshTabFromDisk: (path: string) => Promise<void>;
  clearError: () => void;
  clearConflict: (path?: string) => void;
  clearReveal: (token?: number) => void;
  setCursor: (cursor: EditorCursor | null) => void;
  setDocInfo: (info: EditorDocInfo | null) => void;
  dismissRecoveryNotice: () => void;
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function isConflictError(error: unknown) {
  return asMessage(error).includes("changed on disk");
}

function tabFromRead(
  file: Awaited<ReturnType<typeof ipc.fsRead>>,
  editorConfig: EditorConfigSettings | null = null,
): EditorTab {
  const degrade = file.truncated || file.longLines || file.lossy;
  const content = normalizeEol(file.content);
  return {
    path: file.path,
    name: basename(file.path),
    content,
    savedContent: content,
    hash: file.hash,
    truncated: file.truncated,
    longLines: file.longLines,
    readOnly: file.readOnly || degrade,
    lossy: file.lossy,
    encoding: file.encoding,
    savedEncoding: file.encoding,
    bom: file.bom,
    savedBom: file.bom,
    eol: detectEol(file.content),
    savedEol: detectEol(file.content),
    editorConfig,
    preview: null,
  };
}

function tabFromPreview(preview: MediaPreviewResult): EditorTab {
  return {
    path: preview.path,
    name: basename(preview.path),
    content: "",
    savedContent: "",
    hash: "",
    truncated: false,
    longLines: false,
    readOnly: true,
    lossy: false,
    encoding: "UTF-8",
    savedEncoding: "UTF-8",
    bom: false,
    savedBom: false,
    eol: "LF",
    savedEol: "LF",
    preview,
  };
}

async function readEditorTab(path: string, encoding?: string): Promise<EditorTab> {
  const preview = await ipc.fsMediaPreview(path);
  if (preview) return tabFromPreview(preview);
  const editorConfig = await ipc.editorConfigResolve(path).catch(() => null);
  const configuredEncoding = encoding ?? encodingFromEditorConfig(editorConfig);
  const file = configuredEncoding
    ? await ipc.fsRead(path, configuredEncoding)
    : await ipc.fsRead(path);
  const tab = tabFromRead(file, editorConfig);
  if (!encoding && editorConfig?.charset) {
    tab.encoding = configuredEncoding ?? tab.encoding;
    tab.savedEncoding = tab.encoding;
    if (editorConfig.charset === "utf-8-bom" || editorConfig.charset.startsWith("utf-16")) {
      tab.bom = true;
      tab.savedBom = true;
    }
  }
  return tab;
}

function encodingFromEditorConfig(config: EditorConfigSettings | null): string | undefined {
  switch (config?.charset) {
    case "latin1":
      return "windows-1252";
    case "utf-8":
    case "utf-8-bom":
      return "UTF-8";
    case "utf-16le":
      return "UTF-16LE";
    case "utf-16be":
      return "UTF-16BE";
    default:
      return undefined;
  }
}

function eolFromEditorConfig(config: EditorConfigSettings | null): EditorEol | undefined {
  switch (config?.endOfLine) {
    case "crlf":
      return "CRLF";
    case "lf":
    case "cr":
      return "LF";
    default:
      return undefined;
  }
}

/**
 * Close-time guard. Deliberately not used for tab switches or file opens —
 * dirty buffers stay alive in the store across navigation, exactly like every
 * other editor. Only destroying a buffer (closing its tab, reopening with a
 * different encoding) needs a decision.
 */
async function prepareToLeave(path: string): Promise<boolean> {
  flushPendingEditorChanges();
  const tab = useEditorStore.getState().tabs.find((item) => item.path === path);
  if (!tab || !isEditorTabDirty(tab)) return true;

  const decision = await requestUnsavedDecision(tab.name);
  if (decision === "cancel") return false;
  if (decision === "save") return useEditorStore.getState().saveTab(path);

  useEditorStore.setState((state) => ({
    tabs: state.tabs.map((item) =>
      item.path === path
        ? {
            ...item,
            content: item.savedContent,
            encoding: item.savedEncoding,
            bom: item.savedBom,
            eol: item.savedEol,
            revision: (item.revision ?? 0) + 1,
          }
        : item,
    ),
  }));
  return true;
}

let revealToken = 0;
let untitledCounter = 0;

function nextUntitledPath(tabs: EditorTab[]): string {
  // Recovery can restore untitled buffers, so the counter alone is not enough:
  // skip every index that is already taken.
  for (const tab of tabs) {
    if (!isUntitledPath(tab.path)) continue;
    const index = Number.parseInt(tab.path.slice(UNTITLED_PREFIX.length), 10);
    if (Number.isFinite(index)) untitledCounter = Math.max(untitledCounter, index);
  }
  untitledCounter += 1;
  return `${UNTITLED_PREFIX}${untitledCounter}`;
}

function untitledTab(tabs: EditorTab[]): EditorTab {
  const path = nextUntitledPath(tabs);
  return {
    path,
    name: untitledLabel(path),
    content: "",
    savedContent: "",
    hash: "",
    truncated: false,
    longLines: false,
    readOnly: false,
    lossy: false,
    encoding: "UTF-8",
    savedEncoding: "UTF-8",
    bom: false,
    savedBom: false,
    eol: "LF",
    savedEol: "LF",
  };
}

/**
 * Saves are serialized per path. Ctrl+S can arrive twice in one keydown (the
 * CodeMirror keymap and the window-level shortcut both fire), and two
 * concurrent writes carrying the same expected hash make the second one fail
 * the optimistic lock spuriously.
 */
const saveQueues = new Map<string, Promise<boolean>>();

function enqueueSave(path: string, run: () => Promise<boolean>): Promise<boolean> {
  const previous = saveQueues.get(path) ?? Promise.resolve(true);
  const next = previous
    .catch(() => false)
    .then(run)
    .finally(() => {
      if (saveQueues.get(path) === next) saveQueues.delete(path);
    });
  saveQueues.set(path, next);
  return next;
}

export const useEditorStore = create<EditorState>((set, get) => ({
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

  openFile: async (path, options) => {
    const line = options?.line;
    const column = options?.column ?? 1;

    const queueReveal = () => {
      if (line == null || line < 1) return;
      revealToken += 1;
      set({
        reveal: { path, line, column: Math.max(1, column), token: revealToken },
      });
    };

    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      if (options?.reload && existing.content === existing.savedContent) {
        try {
          const next = await readEditorTab(path);
          if (
            next.hash !== existing.hash ||
            next.content !== existing.savedContent ||
            next.preview?.dataUrl !== existing.preview?.dataUrl ||
            next.preview?.size !== existing.preview?.size
          ) {
            set((state) => ({
              tabs: state.tabs.map((tab) => (tab.path === path ? next : tab)),
            }));
          }
        } catch (error) {
          set({ error: asMessage(error) });
        }
      }
      if (options?.preview === false && existing.ephemeral) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.path === path ? { ...tab, ephemeral: false } : tab,
          ),
        }));
      }
      get().activateTab(path);
      queueReveal();
      return;
    }

    set({ loading: true, error: null });
    try {
      const tab = {
        ...(await readEditorTab(path)),
        ephemeral: options?.preview === true,
      };
      set((state) => {
        // A second open for the same path can race the first (single-click
        // preview followed by double-click pin). Never append a duplicate.
        const already = state.tabs.some((item) => item.path === tab.path);
        const replaceable =
          !already && options?.preview
            ? state.tabs.find(
                (item) =>
                  item.ephemeral &&
                  !isEditorTabDirty(item) &&
                  item.path !== state.secondaryPath,
              )
            : null;
        const tabs = already
          ? state.tabs.map((item) =>
              item.path === tab.path && !isEditorTabDirty(item) ? tab : item,
            )
          : replaceable
            ? state.tabs.map((item) => (item.path === replaceable.path ? tab : item))
            : [...state.tabs, tab];
        return {
          tabs,
          activePath: tab.path,
          primaryPath:
            state.focusedPane === "primary" || !state.secondaryPath
              ? tab.path
              : state.primaryPath,
          secondaryPath:
            state.focusedPane === "secondary" && state.secondaryPath
              ? tab.path
              : state.secondaryPath,
          loading: false,
        };
      });
      queueReveal();
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  newUntitled: () => {
    set((state) => {
      const tab = untitledTab(state.tabs);
      const replaceable = state.tabs.find(
        (item) =>
          item.ephemeral &&
          !isEditorTabDirty(item) &&
          item.path !== state.secondaryPath,
      );
      const tabs = replaceable
        ? state.tabs.map((item) => (item.path === replaceable.path ? tab : item))
        : [...state.tabs, tab];
      return {
        tabs,
        activePath: tab.path,
        primaryPath:
          state.focusedPane === "primary" || !state.secondaryPath
            ? tab.path
            : state.primaryPath,
        secondaryPath:
          state.focusedPane === "secondary" && state.secondaryPath
            ? tab.path
            : state.secondaryPath,
        error: null,
      };
    });
  },

  activateTab: (path) => {
    if (get().activePath === path) return;
    if (!get().tabs.some((tab) => tab.path === path)) return;
    set((state) => ({
      activePath: path,
      primaryPath:
        state.focusedPane === "primary" || !state.secondaryPath
          ? path
          : path === state.primaryPath
            ? state.secondaryPath
            : state.primaryPath,
      secondaryPath:
        state.focusedPane === "secondary" && state.secondaryPath
          ? path
          : path === state.secondaryPath
            ? state.primaryPath
            : state.secondaryPath,
      error: null,
    }));
  },

  focusPane: (focusedPane) => {
    const state = get();
    const activePath =
      focusedPane === "secondary" && state.secondaryPath
        ? state.secondaryPath
        : state.primaryPath;
    set({
      focusedPane: focusedPane === "secondary" && state.secondaryPath ? "secondary" : "primary",
      activePath: activePath ?? state.activePath,
    });
  },

  splitActive: () => {
    const state = get();
    if (state.secondaryPath || state.tabs.length < 2) return;
    const primaryPath = state.activePath ?? state.tabs[0]?.path ?? null;
    const activeIndex = state.tabs.findIndex((tab) => tab.path === primaryPath);
    const secondaryPath =
      state.tabs[(activeIndex + 1) % state.tabs.length]?.path ?? null;
    if (!primaryPath || !secondaryPath || primaryPath === secondaryPath) return;
    set({
      primaryPath,
      secondaryPath,
      focusedPane: "secondary",
      activePath: secondaryPath,
    });
  },

  closeSplit: () => {
    const state = get();
    const primaryPath = state.primaryPath ?? state.activePath ?? state.tabs[0]?.path ?? null;
    set({
      primaryPath,
      secondaryPath: null,
      focusedPane: "primary",
      activePath: primaryPath,
    });
  },

  reorderTabs: (sourcePath, targetPath) => {
    if (sourcePath === targetPath) return;
    set((state) => {
      const source = state.tabs.findIndex((tab) => tab.path === sourcePath);
      const target = state.tabs.findIndex((tab) => tab.path === targetPath);
      if (source < 0 || target < 0) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(source, 1);
      tabs.splice(target, 0, moved);
      return { tabs };
    });
  },

  pinTab: (path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path ? { ...tab, ephemeral: false } : tab,
      ),
    })),

  closeTab: async (path) => {
    if (!(await prepareToLeave(path))) return;
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.path !== path);
      let primaryPath = state.primaryPath;
      let secondaryPath = state.secondaryPath;
      let focusedPane = state.focusedPane;
      if (secondaryPath === path) {
        secondaryPath = null;
        focusedPane = "primary";
      }
      if (primaryPath === path) {
        if (secondaryPath) {
          primaryPath = secondaryPath;
          secondaryPath = null;
        } else {
          primaryPath = tabs.at(-1)?.path ?? null;
        }
        focusedPane = "primary";
      }
      const activePath =
        focusedPane === "secondary" && secondaryPath ? secondaryPath : primaryPath;
      return {
        tabs,
        activePath,
        primaryPath,
        secondaryPath,
        focusedPane,
        conflictPath: state.conflictPath === path ? null : state.conflictPath,
      };
    });
    useDiagnosticsStore.getState().clearFile(path);
  },

  setContent: (path, content) => {
    set((state) => {
      const target = state.tabs.find((tab) => tab.path === path);
      // The editor echoes content back after saves and disk syncs; skip the
      // no-op update instead of re-rendering every subscriber.
      if (!target || (target.content === content && !target.ephemeral)) return state;
      return {
        // Editing pins an explorer preview so it cannot be replaced.
        tabs: state.tabs.map((tab) =>
          tab.path === path ? { ...tab, content, ephemeral: false } : tab,
        ),
      };
    });
  },

  applyExternalEdit: (path, content) => {
    const normalized = normalizeEol(content);
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path && !tab.readOnly && tab.content !== normalized
          ? {
              ...tab,
              content: normalized,
              revision: (tab.revision ?? 0) + 1,
              ephemeral: false,
            }
          : tab,
      ),
    }));
  },

  setLineEnding: (path, eol) => {
    set((state) => ({
      // Metadata only — the buffer stays LF; `eol` is applied at save time.
      tabs: state.tabs.map((tab) =>
        tab.path === path && !tab.readOnly ? { ...tab, eol } : tab,
      ),
      docInfo:
        state.activePath === path && state.docInfo
          ? { ...state.docInfo, eol }
          : state.docInfo,
    }));
  },

  setEncoding: (path, encoding) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path && !tab.readOnly
          ? {
              ...tab,
              encoding,
              bom: encoding.startsWith("UTF-16") ? true : tab.bom,
            }
          : tab,
      ),
    }));
  },

  reopenWithEncoding: async (path, encoding) => {
    const current = get().tabs.find((tab) => tab.path === path);
    if (!current) return;
    if (isEditorTabDirty(current) && !(await prepareToLeave(path))) return;
    set({ loading: true, error: null });
    try {
      const next = await readEditorTab(path, encoding);
      set((state) => ({
        loading: false,
        tabs: state.tabs.map((tab) => (tab.path === path ? next : tab)),
      }));
    } catch (error) {
      set({ loading: false, error: asMessage(error) });
    }
  },

  saveTab: (path, options) =>
    enqueueSave(path, async () => {
      flushPendingEditorChanges();
      const active = get().tabs.find((tab) => tab.path === path);
      if (!active || active.readOnly || active.preview) return true;

      // Untitled buffers have no on-disk path: ask for one first (Save As).
      let targetPath = active.path;
      const untitled = isUntitledPath(active.path);
      if (untitled) {
        const chosen = await saveDialog({
          defaultPath: active.name,
          filters: [
            { name: "All files", extensions: ["*"] },
            { name: "Text", extensions: ["txt", "md"] },
          ],
        });
        if (typeof chosen !== "string") return false;
        targetPath = chosen;
      }

      const prefs = usePrefsStore.getState();
      const editorConfig = await ipc
        .editorConfigResolve(targetPath)
        .catch(() => active.editorConfig ?? null);
      const configuredEncoding = encodingFromEditorConfig(editorConfig);
      const encoding = configuredEncoding ?? active.encoding;
      const bom = editorConfig?.charset
        ? editorConfig.charset === "utf-8-bom" || editorConfig.charset.startsWith("utf-16")
        : active.bom;
      const eol = eolFromEditorConfig(editorConfig) ?? active.eol;
      // Hygiene runs on the LF buffer and stays LF; the real line ending is
      // applied to the wire payload only, so `savedContent` remains comparable
      // with the live buffer.
      const prepared = prepareContentForSave(targetPath, active.content, {
        trimTrailingWhitespace:
          editorConfig?.trimTrailingWhitespace ?? prefs.trimTrailingWhitespace,
        insertFinalNewline:
          editorConfig?.insertFinalNewline ?? prefs.insertFinalNewline,
        removeFinalNewline: editorConfig?.insertFinalNewline === false,
        formatOnSave: prefs.formatOnSave,
        tabSize: editorConfig?.indentSize ?? prefs.tabSize,
        endOfLine: "lf",
      });
      if (
        !untitled &&
        prepared === active.savedContent &&
        encoding === active.savedEncoding &&
        bom === active.savedBom &&
        eol === active.savedEol
      ) {
        return true;
      }

      set({ loading: true, error: null });
      try {
        const result = await ipc.fsWrite(
          targetPath,
          convertLineEndings(prepared, eol),
          untitled || options?.force ? undefined : active.hash,
          encoding,
          bom,
        );
        const remapped: Partial<EditorTab> = {
          path: targetPath,
          name: basename(targetPath),
          hash: result.hash,
          savedContent: prepared,
          encoding,
          savedEncoding: encoding,
          bom,
          savedBom: bom,
          eol,
          savedEol: eol,
          editorConfig,
        };
        set((state) => {
          const remapPanePath = (panePath: string | null) =>
            panePath === active.path ? targetPath : panePath;
          // Saving an untitled buffer onto a path that is already open must not
          // create a second tab: fold the saved buffer into the existing tab.
          const existsElsewhere =
            targetPath !== active.path && state.tabs.some((tab) => tab.path === targetPath);
          const tabs = state.tabs
            .filter((tab) => !(existsElsewhere && tab.path === targetPath))
            .map((tab) => {
              if (tab.path === active.path) {
                return {
                  ...tab,
                  ...remapped,
                  content: tab.content === active.content ? prepared : tab.content,
                };
              }
              return tab;
            });
          return {
            loading: false,
            tabs,
            activePath: remapPanePath(state.activePath),
            primaryPath: remapPanePath(state.primaryPath),
            secondaryPath: remapPanePath(state.secondaryPath),
            conflictPath:
              state.conflictPath === active.path ? null : state.conflictPath,
          };
        });
        return true;
      } catch (error) {
        if (isConflictError(error)) {
          set({ loading: false, error: null, conflictPath: active.path });
        } else {
          set({ loading: false, error: asMessage(error) });
        }
        return false;
      }
    }),

  saveActive: async () => {
    const activePath = get().activePath;
    if (activePath) await get().saveTab(activePath);
  },

  syncFromDisk: async (paths) => {
    const wanted = new Set(paths.map(normalizePath));
    if (wanted.size === 0) return;

    const candidates = get().tabs.filter(
      (tab) =>
        wanted.has(normalizePath(tab.path)) && !isEditorTabDirty(tab) && !tab.readOnly,
    );
    if (candidates.length === 0) return;

    await Promise.all(
      candidates.map(async (tab) => {
        try {
          const next = await readEditorTab(tab.path);
          if (next.hash === tab.hash && next.content === tab.savedContent) return;
          set((state) => ({
            tabs: state.tabs.map((item) => {
              if (item.path !== tab.path) return item;
              // Skip if the user dirtied the tab while we were reading.
              if (isEditorTabDirty(item)) return item;
              return next;
            }),
          }));
        } catch {
          // File disappeared — close the tab only when it was still clean.
          set((state) => {
            const current = state.tabs.find((item) => item.path === tab.path);
            if (!current || isEditorTabDirty(current)) return state;
            const tabs = state.tabs.filter((item) => item.path !== tab.path);
            const primaryPath =
              state.primaryPath === tab.path ? tabs.at(-1)?.path ?? null : state.primaryPath;
            const secondaryPath =
              state.secondaryPath === tab.path ? null : state.secondaryPath;
            return {
              tabs,
              primaryPath,
              secondaryPath,
              focusedPane: secondaryPath ? state.focusedPane : "primary",
              activePath:
                state.activePath === tab.path
                  ? secondaryPath ?? primaryPath
                  : state.activePath,
            };
          });
        }
      }),
    );
  },

  refreshTabFromDisk: async (path) => {
    if (!get().tabs.some((tab) => normalizePath(tab.path) === normalizePath(path))) return;
    try {
      const next = await readEditorTab(path);
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          normalizePath(tab.path) === normalizePath(path) ? next : tab,
        ),
        error: null,
        conflictPath:
          state.conflictPath !== null &&
          normalizePath(state.conflictPath) === normalizePath(path)
            ? null
            : state.conflictPath,
      }));
    } catch (error) {
      set({ error: asMessage(error) });
    }
  },

  clearError: () => set({ error: null }),

  clearConflict: (path) => {
    set((state) =>
      path === undefined || state.conflictPath === path ? { conflictPath: null } : state,
    );
  },

  clearReveal: (token) => {
    set((state) => {
      if (token != null && state.reveal?.token !== token) return state;
      return { reveal: null };
    });
  },

  setCursor: (cursor) => set({ cursor }),
  setDocInfo: (info) => set({ docInfo: info }),
  dismissRecoveryNotice: () => set({ recoveryNotice: null }),
}));
