import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { hoverTooltip, type EditorView } from "@codemirror/view";

import { ipc, type LspLocation, type LspTextEdit } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import { lspEnabledFor } from "@/lib/stores/lspStore";

/** Everything a request needs to identify the document being edited. */
export interface LspDocContext {
  projectPath: string;
  path: string;
  languageId: string;
}

export type LspContextGetter = () => LspDocContext | null;

/** A rename touching more files than this is almost certainly not what the user meant. */
const MAX_RENAME_FILES = 50;
const HOVER_DELAY_MS = 320;

function activeContext(getContext: LspContextGetter): LspDocContext | null {
  const context = getContext();
  if (!context || !lspEnabledFor(context.languageId)) return null;
  return context;
}

/** CodeMirror offset → protocol position (0-based line, UTF-16 character). */
function protocolPosition(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
}

export function lspCompletionSource(getContext: LspContextGetter) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const doc = activeContext(getContext);
    if (!doc) return null;
    const token = context.matchBefore(/[\w$]*/);
    if (!context.explicit && !token) return null;
    const { line, character } = protocolPosition(context.state, context.pos);
    const items = await ipc
      .lspCompletion(
        doc.projectPath,
        doc.path,
        doc.languageId,
        context.state.doc.toString(),
        line,
        character,
      )
      .catch(() => []);
    if (context.aborted || items.length === 0) return null;

    const options: Completion[] = [...items]
      .sort((left, right) =>
        (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label),
      )
      .map((item, index) => ({
        label: item.label,
        detail: item.detail ?? undefined,
        info: item.documentation ?? undefined,
        type: item.kind ?? "text",
        // Only override the inserted text when it differs, so CodeMirror keeps
        // its own range handling for the common case.
        apply: item.insertText === item.label ? undefined : item.insertText,
        // Outrank the buffer/keyword/path heuristics, which top out at 90.
        boost: 99 - Math.min(index, 39),
      }));
    return {
      from: token?.from ?? context.pos,
      options,
      validFor: /^[\w$]*$/,
    };
  };
}

export function lspHoverExtension(getContext: LspContextGetter) {
  return hoverTooltip(
    async (view, pos) => {
      const doc = activeContext(getContext);
      if (!doc) return null;
      const { line, character } = protocolPosition(view.state, pos);
      const hover = await ipc
        .lspHover(
          doc.projectPath,
          doc.path,
          doc.languageId,
          view.state.doc.toString(),
          line,
          character,
        )
        .catch(() => null);
      const contents = hover?.contents.trim();
      if (!contents) return null;
      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-lsp-hover";
          // Servers return markdown. Rendering it as text keeps untrusted
          // server output out of the DOM as markup; CSS preserves the layout.
          dom.textContent = contents;
          return { dom };
        },
      };
    },
    { hoverTime: HOVER_DELAY_MS },
  );
}

async function locationsAt(
  view: EditorView,
  doc: LspDocContext,
  kind: "definition" | "references",
): Promise<LspLocation[]> {
  const pos = view.state.selection.main.head;
  const { line, character } = protocolPosition(view.state, pos);
  const request = kind === "definition" ? ipc.lspDefinition : ipc.lspReferences;
  return request(
    doc.projectPath,
    doc.path,
    doc.languageId,
    view.state.doc.toString(),
    line,
    character,
  ).catch(() => []);
}

export async function lspGoToDefinition(
  view: EditorView,
  getContext: LspContextGetter,
): Promise<LspLocation[]> {
  const doc = activeContext(getContext);
  if (!doc) return [];
  const locations = await locationsAt(view, doc, "definition");
  if (locations.length === 1) {
    await revealLocation(locations[0]);
    return [];
  }
  return locations;
}

export async function lspFindReferences(
  view: EditorView,
  getContext: LspContextGetter,
): Promise<LspLocation[]> {
  const doc = activeContext(getContext);
  if (!doc) return [];
  return locationsAt(view, doc, "references");
}

export async function revealLocation(location: LspLocation) {
  await useEditorStore
    .getState()
    .openFile(location.path, { line: location.line, column: location.column });
}

/** Byte-free offset table: index `n` is where line `n + 1` starts. */
function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function offsetAt(
  content: string,
  offsets: number[],
  line: number,
  column: number,
): number {
  const index = Math.min(Math.max(1, line), offsets.length) - 1;
  const start = offsets[index];
  const lineEnd = index + 1 < offsets.length ? offsets[index + 1] - 1 : content.length;
  return Math.min(start + Math.max(0, column - 1), Math.max(start, lineEnd));
}

/**
 * Apply one file's edits to a string. Later edits are applied first so earlier
 * offsets stay valid, and overlapping ranges are dropped rather than corrupting
 * the document.
 */
export function applyTextEdits(content: string, edits: LspTextEdit[]): string {
  const offsets = lineOffsets(content);
  const resolved = edits
    .map((edit) => ({
      from: offsetAt(content, offsets, edit.startLine, edit.startColumn),
      to: offsetAt(content, offsets, edit.endLine, edit.endColumn),
      text: edit.newText,
    }))
    .filter((edit) => edit.to >= edit.from)
    .sort((left, right) => right.from - left.from || right.to - left.to);

  let output = content;
  let boundary = content.length;
  for (const edit of resolved) {
    if (edit.to > boundary) continue;
    output = output.slice(0, edit.from) + edit.text + output.slice(edit.to);
    boundary = edit.from;
  }
  return output;
}

export interface RenameOutcome {
  status: "applied" | "empty" | "too-many-files" | "failed";
  files: number;
  edits: number;
  message?: string;
}

/**
 * Rename lands as dirty buffers rather than silent disk writes: the user sees
 * every touched file, can undo per tab, and saves when satisfied.
 */
export async function lspRename(
  view: EditorView,
  getContext: LspContextGetter,
  newName: string,
): Promise<RenameOutcome> {
  const doc = activeContext(getContext);
  if (!doc) return { status: "failed", files: 0, edits: 0 };
  const pos = view.state.selection.main.head;
  const { line, character } = protocolPosition(view.state, pos);

  let edits: LspTextEdit[];
  try {
    edits = await ipc.lspRename(
      doc.projectPath,
      doc.path,
      doc.languageId,
      view.state.doc.toString(),
      line,
      character,
      newName,
    );
  } catch (error) {
    return {
      status: "failed",
      files: 0,
      edits: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (edits.length === 0) return { status: "empty", files: 0, edits: 0 };

  const byPath = new Map<string, LspTextEdit[]>();
  for (const edit of edits) {
    const bucket = byPath.get(edit.path);
    if (bucket) bucket.push(edit);
    else byPath.set(edit.path, [edit]);
  }
  if (byPath.size > MAX_RENAME_FILES) {
    return { status: "too-many-files", files: byPath.size, edits: edits.length };
  }

  const store = useEditorStore.getState();
  for (const [path, fileEdits] of byPath) {
    if (!store.tabs.some((tab) => tab.path === path)) {
      await store.openFile(path);
    }
    const tab = useEditorStore.getState().tabs.find((entry) => entry.path === path);
    if (!tab || tab.truncated || tab.readOnly) continue;
    useEditorStore.getState().setContent(path, applyTextEdits(tab.content, fileEdits));
  }
  return { status: "applied", files: byPath.size, edits: edits.length };
}
