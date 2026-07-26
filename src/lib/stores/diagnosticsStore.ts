import { create } from "zustand";

import {
  diagnosticCounts,
  parseDiagnosticText,
  type DiagnosticSource,
  type GlyphraDiagnostic,
} from "@/lib/diagnostics";

const MAX_DIAGNOSTICS = 500;
const MAX_INGEST_CHARS = 512 * 1024;
const ingestedText = new Map<DiagnosticSource, { cwd: string; text: string }>();

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

function sortDiagnostics(items: GlyphraDiagnostic[]) {
  const severity = { error: 0, warning: 1, info: 2 };
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort(
      (left, right) =>
        severity[left.severity] - severity[right.severity]
        || normalizePath(left.path).localeCompare(normalizePath(right.path))
        || left.line - right.line
        || left.column - right.column,
    )
    .slice(0, MAX_DIAGNOSTICS);
}

interface DiagnosticsState {
  diagnostics: GlyphraDiagnostic[];
  problemsOpen: boolean;
  setProblemsOpen: (open: boolean) => void;
  toggleProblems: () => void;
  replaceFile: (
    source: DiagnosticSource,
    path: string,
    diagnostics: GlyphraDiagnostic[],
  ) => void;
  ingestText: (
    source: Exclude<DiagnosticSource, "editor">,
    text: string,
    cwd: string,
  ) => void;
  clearSource: (source: DiagnosticSource) => void;
  clearFile: (path: string) => void;
  clearAll: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  diagnostics: [],
  problemsOpen: false,

  setProblemsOpen: (problemsOpen) => set({ problemsOpen }),
  toggleProblems: () => set({ problemsOpen: !get().problemsOpen }),

  replaceFile: (source, path, diagnostics) => {
    const key = normalizePath(path);
    set((state) => ({
      diagnostics: sortDiagnostics([
        ...state.diagnostics.filter(
          (item) => item.source !== source || normalizePath(item.path) !== key,
        ),
        ...diagnostics,
      ]),
    }));
  },

  ingestText: (source, text, cwd) => {
    const prior = ingestedText.get(source);
    const combined = `${prior?.cwd === cwd ? prior.text : ""}${text}`;
    const bounded = combined.slice(-MAX_INGEST_CHARS);
    ingestedText.set(source, { cwd, text: bounded });
    const parsed = parseDiagnosticText(bounded, source, cwd);
    const replacedSources = source === "terminal"
      ? new Set<DiagnosticSource>(["terminal", "build"])
      : new Set<DiagnosticSource>([source]);
    set((state) => ({
      diagnostics: sortDiagnostics([
        ...state.diagnostics.filter((item) => !replacedSources.has(item.source)),
        ...parsed,
      ]),
    }));
  },

  clearSource: (source) => {
    ingestedText.delete(source);
    set((state) => ({
      diagnostics: state.diagnostics.filter((item) => item.source !== source),
    }));
  },

  clearFile: (path) => {
    const key = normalizePath(path);
    set((state) => ({
      diagnostics: state.diagnostics.filter(
        (item) => normalizePath(item.path) !== key,
      ),
    }));
  },

  clearAll: () => {
    ingestedText.clear();
    set({ diagnostics: [] });
  },
}));

export function currentDiagnosticCounts() {
  return diagnosticCounts(useDiagnosticsStore.getState().diagnostics);
}
