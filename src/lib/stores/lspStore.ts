import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { lspSettingGroup } from "@/features/editor/lspLanguage";
import type { DiagnosticSeverity, GlyphraDiagnostic } from "@/lib/diagnostics";
import type { LspDiagnostic, LspDiagnosticsEvent, LspServerStatus } from "@/lib/ipc/ipc";

import { useDiagnosticsStore } from "./diagnosticsStore";
import { usePrefsStore } from "./prefsStore";

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

/**
 * Which language published diagnostics for a file, so a server that exits only
 * retracts its own findings instead of wiping the whole Problems panel.
 */
const languageByPath = new Map<string, { path: string; languageId: string }>();

interface LspState {
  /** Latest status per `languageId`, keyed by the id the backend reported. */
  statuses: Record<string, LspServerStatus>;
  setStatus: (status: LspServerStatus) => void;
  reset: () => void;
}

export const useLspStore = create<LspState>((set) => ({
  statuses: {},
  setStatus: (status) =>
    set((state) => ({ statuses: { ...state.statuses, [status.languageId]: status } })),
  reset: () => {
    languageByPath.clear();
    set({ statuses: {} });
  },
}));

/** Master switch plus the per-language opt-out, both from user settings. */
export function lspEnabledFor(languageId: string | null): languageId is string {
  if (!languageId) return false;
  const prefs = usePrefsStore.getState();
  return (
    prefs.languageServer
    && !prefs.languageServerDisabled.includes(lspSettingGroup(languageId))
  );
}

export function lspStatusFor(languageId: string | null): LspServerStatus | null {
  if (!languageId) return null;
  return useLspStore.getState().statuses[languageId] ?? null;
}

function toGlyphraDiagnostic(item: LspDiagnostic): GlyphraDiagnostic {
  const severity: DiagnosticSeverity =
    item.severity === "error" || item.severity === "warning" ? item.severity : "info";
  return {
    id: `lsp:${normalizePath(item.path)}:${item.line}:${item.column}:${severity}:${item.message}`,
    path: item.path,
    line: item.line,
    column: item.column,
    endLine: item.endLine,
    endColumn: item.endColumn,
    severity,
    message: item.message,
    source: "lsp",
    code: item.code ?? undefined,
    at: Date.now(),
  };
}

function applyDiagnostics(event: LspDiagnosticsEvent) {
  const key = normalizePath(event.path);
  if (event.diagnostics.length === 0) {
    languageByPath.delete(key);
  } else {
    languageByPath.set(key, { path: event.path, languageId: event.languageId });
  }
  useDiagnosticsStore
    .getState()
    .replaceFile("lsp", event.path, event.diagnostics.map(toGlyphraDiagnostic));
}

function retractLanguage(languageId: string) {
  const diagnostics = useDiagnosticsStore.getState();
  for (const [key, entry] of [...languageByPath.entries()]) {
    if (entry.languageId !== languageId) continue;
    languageByPath.delete(key);
    diagnostics.replaceFile("lsp", entry.path, []);
  }
}

let listeners: Promise<UnlistenFn[]> | null = null;

/**
 * Subscribe once per window. Idempotent: every editor mount can call it, and
 * the listeners outlive individual tabs so a background compile still reports.
 */
export function ensureLspListeners(): Promise<UnlistenFn[]> {
  if (listeners) return listeners;
  listeners = Promise.all([
    listen<LspServerStatus>("lsp-status", (event) => {
      useLspStore.getState().setStatus(event.payload);
      if (event.payload.state !== "ready") retractLanguage(event.payload.languageId);
    }),
    listen<LspDiagnosticsEvent>("lsp-diagnostics", (event) => {
      applyDiagnostics(event.payload);
    }),
  ]).catch((error) => {
    // A failed subscription must not pin the rejected promise, or every later
    // caller inherits the same failure without ever retrying.
    listeners = null;
    throw error;
  });
  return listeners;
}

export const lspTestHooks = { applyDiagnostics, retractLanguage, toGlyphraDiagnostic };
