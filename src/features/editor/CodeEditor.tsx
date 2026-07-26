import { autocompletion } from "@codemirror/autocomplete";
import { indentUnit, syntaxTree } from "@codemirror/language";
import {
  lintGutter,
  setDiagnostics,
  type Diagnostic as CodeMirrorDiagnostic,
} from "@codemirror/lint";
import { redo, selectAll, undo } from "@codemirror/commands";
import { getChunks, unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { basicSetup } from "codemirror";
import {
  ClipboardPaste,
  Copy,
  MessageSquarePlus,
  Redo2,
  Scissors,
  Sparkles,
  TextSelect,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { inlineAgent, InlineAgentCancelled } from "@/lib/acp/inlineAgent";
import { copyText, readClipboardText } from "@/lib/clipboard";
import { analyzeEditorDocument, type GlyphraDiagnostic } from "@/lib/diagnostics";
import { glyphraCompletionSource } from "@/lib/editorCompletion";
import {
  buildGhostTextPrompt,
  buildInlineEditPrompt,
  extractCodeBlock,
  headLines,
  normalizeInlineResult,
  sanitizeGhostText,
  shouldRequestGhostText,
  tailLines,
  GHOST_TEXT_PREFIX_LINES,
  GHOST_TEXT_SUFFIX_LINES,
  INLINE_EDIT_CONTEXT_LINES,
  INLINE_EDIT_MAX_RESULT,
  INLINE_EDIT_MAX_SELECTION,
} from "@/lib/inlineEdit";
import { codeMirrorKey } from "@/lib/keybindings";
import { ipc, type LspLocation } from "@/lib/ipc/ipc";
import type { EditorCursor, EditorTab } from "@/lib/stores/editorStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useDiagnosticsStore } from "@/lib/stores/diagnosticsStore";
import { ensureLspListeners, lspEnabledFor, useLspStore } from "@/lib/stores/lspStore";
import {
  EDITOR_COMMAND_EVENT,
  type EditorCommand,
} from "@/lib/editorCommands";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { focusAgentComposer, useComposerDraft } from "@/lib/stores/composerStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { reviewFileKey, useReviewStore } from "@/lib/stores/reviewStore";
import { useUiStore } from "@/lib/stores/uiStore";

import { editorThemeExtensions } from "./cmTheme";
import EditorMinimap from "./EditorMinimap";
import { editorVisualExtensions } from "./editorVisuals";
import { resolveEditorLanguage } from "./editorLanguage";
import { ghostTextExtension } from "./ghostText";
import {
  lspCompletionSource,
  lspFindReferences,
  lspGoToDefinition,
  lspHoverExtension,
  lspRename,
  revealLocation,
  type LspDocContext,
} from "./lspExtension";
import { lspLanguageId, lspSettingGroup } from "./lspLanguage";
import InlineEditPanel, { type InlineEditStatus } from "./InlineEditPanel";
import { LspLocationsPanel, LspNotice, LspRenamePanel } from "./LspPanels";
import { modifiedCodeMarkerExtension } from "./modifiedCodeMarkers";

function readCursor(state: EditorState): EditorCursor {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  return { line: line.number, col: sel.head - line.from + 1, selChars: sel.to - sel.from };
}

interface CodeEditorProps {
  tab: EditorTab;
  onChange: (content: string) => void;
  onSave: () => void;
  focused?: boolean;
  onFocus?: () => void;
}

interface ScopeLine {
  from: number;
  line: number;
  label: string;
  symbol: string | null;
}

interface InlineEditState {
  x: number;
  y: number;
  /** Range the rewrite targets, updated to the applied range in preview. */
  from: number;
  to: number;
  original: string;
  firstLine: number;
  lastLine: number;
  hasSelection: boolean;
  instruction: string;
  status: InlineEditStatus;
  error: string | null;
}

/** Longest document we are willing to feed to a completion request. */
const GHOST_TEXT_MAX_DOC = 400_000;

type AgentAction = "review" | "explain" | "rewrite" | "test";

const AGENT_PROMPTS: Record<AgentAction, string> = {
  review: "Review this selection for correctness, edge cases, and regressions.",
  explain: "Explain this selection clearly and concisely.",
  rewrite: "Rewrite this selection with clearer structure while preserving behavior.",
  test: "Add or suggest focused tests for this selection.",
};

function editorChrome(
  fontSize: number,
  wordWrap: boolean,
  showLineNumbers: boolean,
  tabSize: number,
  indentStyle: "tab" | "space",
) {
  return [
    EditorView.theme({
      "&": { fontSize: `${fontSize}px` },
      ".cm-content": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
      ".cm-gutters": {
        fontSize: `${Math.max(10, fontSize - 1)}px`,
        ...(showLineNumbers ? {} : { display: "none" }),
      },
    }),
    indentUnit.of(indentStyle === "tab" ? "\t" : " ".repeat(tabSize)),
    EditorState.tabSize.of(tabSize),
    wordWrap ? EditorView.lineWrapping : [],
  ];
}

function codeMirrorDiagnostics(
  state: EditorState,
  diagnostics: GlyphraDiagnostic[],
): CodeMirrorDiagnostic[] {
  return diagnostics.map((item) => {
    const lineNumber = Math.max(1, Math.min(state.doc.lines, item.line));
    const line = state.doc.line(lineNumber);
    const from = Math.max(
      line.from,
      Math.min(line.to, line.from + Math.max(0, item.column - 1)),
    );
    const requestedEnd = item.endColumn == null
      ? from + 1
      : line.from + Math.max(0, item.endColumn - 1);
    return {
      from,
      to: Math.max(from, Math.min(line.to, requestedEnd)),
      severity: item.severity,
      message: item.message,
      source: item.code ? `${item.source} · ${item.code}` : item.source,
    };
  });
}

function inlineReviewExtension(
  baseline: string,
  acceptLabel: string,
  rejectLabel: string,
  onDecision: () => Promise<void>,
): Extension {
  const renderControl = (type: "accept" | "reject", action: (event: MouseEvent) => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = type === "accept" ? acceptLabel : rejectLabel;
    button.className = `glyphra-inline-review-control glyphra-inline-review-${type}`;
    button.onmousedown = (event) => {
      action(event);
      button.disabled = true;
      queueMicrotask(() => {
        void onDecision().finally(() => {
          button.disabled = false;
        });
      });
    };
    return button;
  };
  return [
    unifiedMergeView({
      original: baseline,
      mergeControls: renderControl,
      gutter: true,
    }),
    EditorView.theme({
      ".cm-changedLine": {
        backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)",
      },
      ".cm-deletedChunk": {
        marginTop: "3px",
        marginBottom: "3px",
      },
      ".glyphra-inline-review-control": {
        border: "1px solid var(--line)",
        borderRadius: "999px",
        background: "var(--raised)",
        color: "var(--ink-2)",
        padding: "1px 7px",
        marginRight: "4px",
        fontSize: "10px",
        cursor: "pointer",
      },
      ".glyphra-inline-review-reject:hover": {
        color: "var(--danger)",
      },
      ".glyphra-inline-review-accept:hover": {
        color: "var(--ok)",
      },
    }),
  ];
}

function projectRelativePath(projectPath: string, path: string) {
  const root = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
  return normalized.slice(root.length + 1);
}

/**
 * IME guard — while composing (Microsoft Pinyin / Sogou / etc.), skip
 * docChanged side-effects so custom decorations/handlers never fight the IME.
 * Flush once on compositionend. See docs/ime-checklist.md.
 */
function imeSafeUpdateListener(onChange: (content: string) => void) {
  return [
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.view.composing) return;
      onChange(update.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      compositionend: (_event, view) => {
        onChange(view.state.doc.toString());
        return false;
      },
    }),
  ];
}

function selectionMeta(view: EditorView) {
  const selection = view.state.selection.main;
  if (selection.empty) return null;
  const text = view.state.sliceDoc(selection.from, selection.to);
  if (!text.trim()) return null;
  const firstLine = view.state.doc.lineAt(selection.from).number;
  const lastLine = view.state.doc.lineAt(
    selection.to > selection.from ? selection.to - 1 : selection.to,
  ).number;
  const endCoords = view.coordsAtPos(selection.to);
  return { text, firstLine, lastLine, endCoords, from: selection.from, to: selection.to };
}

function scopeSymbol(label: string) {
  const match = label.match(
    /\b(?:class|interface|enum|namespace|module|struct|trait|impl|function|fn|def|func)\s+([A-Za-z_$][\w$]*)/,
  );
  return match?.[1] ?? null;
}

function scopeLinesAt(state: EditorState, position: number): ScopeLine[] {
  const bounded = Math.min(position, state.doc.length);
  const currentLine = state.doc.lineAt(bounded).number;
  const scopes: ScopeLine[] = [];
  const seen = new Set<number>();
  let node = syntaxTree(state).resolveInner(bounded, -1);
  while (node.parent) {
    const start = state.doc.lineAt(node.from);
    const end = state.doc.lineAt(Math.min(node.to, state.doc.length));
    if (
      start.number < currentLine &&
      end.number > start.number &&
      !seen.has(start.number)
    ) {
      const label = start.text.trim().slice(0, 180);
      if (label && !/^[{}()[\],;]+$/.test(label)) {
        seen.add(start.number);
        scopes.unshift({
          from: start.from,
          line: start.number,
          label,
          symbol: scopeSymbol(label),
        });
      }
    }
    node = node.parent;
  }
  return scopes.slice(-3);
}

function attachSelectionToAgent(
  tab: EditorTab,
  meta: { text: string; firstLine: number; lastLine: number },
  action?: AgentAction,
) {
  const lines =
    meta.firstLine === meta.lastLine
      ? `L${meta.firstLine}`
      : `L${meta.firstLine}-L${meta.lastLine}`;
  const draft = useComposerDraft.getState();
  draft.addReference({
    kind: "code",
    label: `${tab.name}:${lines}`,
    path: tab.path,
    content: meta.text,
  });
  if (action) draft.setDraft(AGENT_PROMPTS[action]);
  useUiStore.getState().openAgent();
  focusAgentComposer();
}

/**
 * CodeMirror refuses to register a key both directly and as a chord prefix, so
 * an editor binding such as Ctrl+K has to displace the `Ctrl+K …` chords that
 * ship with the VS Code keymap. Ctrl+/ and Ctrl+Shift+[ / ] still cover
 * commenting and folding.
 */
function baseKeymapWithout(reserved: string | null) {
  if (!reserved) return vscodeKeymap;
  return vscodeKeymap.filter((binding) => {
    const key = binding.key ?? "";
    return key !== reserved && !key.startsWith(`${reserved} `);
  });
}

export default function CodeEditor({
  tab,
  onChange,
  onSave,
  focused = true,
  onFocus,
}: CodeEditorProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const hashRef = useRef(tab.hash);
  const revisionRef = useRef(tab.revision ?? 0);
  const focusedRef = useRef(focused);
  const languageNameRef = useRef<string | null>(null);
  focusedRef.current = focused;
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    from: number;
    to: number;
    text: string;
    firstLine: number;
    lastLine: number;
  } | null>(null);
  const [capsule, setCapsule] = useState<{
    x: number;
    y: number;
    text: string;
    firstLine: number;
    lastLine: number;
    menuOpen: boolean;
  } | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [lspLocations, setLspLocations] = useState<{
    kind: "definition" | "references";
    items: LspLocation[];
  } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    value: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [lspNotice, setLspNotice] = useState<string | null>(null);
  const themeCompartment = useRef(new Compartment());
  const keymapCompartment = useRef(new Compartment());
  const prefsCompartment = useRef(new Compartment());
  const modifiedCodeCompartment = useRef(new Compartment());
  const visualsCompartment = useRef(new Compartment());
  const theme = useUiStore((s) => s.theme);
  const fontSize = usePrefsStore((s) => s.fontSize);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const wordWrap = usePrefsStore((s) => s.wordWrap);
  const showLineNumbers = usePrefsStore((s) => s.lineNumbers);
  const minimap = usePrefsStore((s) => s.minimap);
  const breadcrumbs = usePrefsStore((s) => s.breadcrumbs);
  const stickyScroll = usePrefsStore((s) => s.stickyScroll);
  const bracketPairColorization = usePrefsStore((s) => s.bracketPairColorization);
  const indentGuides = usePrefsStore((s) => s.indentGuides);
  const customTheme = usePrefsStore((s) => s.customTheme);
  const inlineEditShortcut = usePrefsStore(
    (s) => s.keybindings.find((b) => b.command === "editor.inlineEdit")?.key ?? null,
  );
  const inlineEditKey = inlineEditShortcut ? codeMirrorKey(inlineEditShortcut) : null;
  const definitionShortcut = usePrefsStore(
    (s) => s.keybindings.find((b) => b.command === "editor.goToDefinition")?.key ?? null,
  );
  const referencesShortcut = usePrefsStore(
    (s) => s.keybindings.find((b) => b.command === "editor.findReferences")?.key ?? null,
  );
  const renameShortcut = usePrefsStore(
    (s) => s.keybindings.find((b) => b.command === "editor.rename")?.key ?? null,
  );
  const definitionKey = definitionShortcut ? codeMirrorKey(definitionShortcut) : null;
  const referencesKey = referencesShortcut ? codeMirrorKey(referencesShortcut) : null;
  const renameKey = renameShortcut ? codeMirrorKey(renameShortcut) : null;
  const reveal = useEditorStore((s) => s.reveal);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);
  const reviewTurns = useReviewStore((s) => s.turns);
  const reviewDecisions = useReviewStore((s) => s.decisions);
  const [reviewContext, setReviewContext] = useState<{
    turnId: string;
    path: string;
    before: string;
  } | null>(null);
  const [breadcrumbSymbol, setBreadcrumbSymbol] = useState<string | null>(null);
  const [stickyScopes, setStickyScopes] = useState<ScopeLine[]>([]);
  const reviewContextRef = useRef(reviewContext);
  reviewContextRef.current = reviewContext;
  const lineEnding = tab.content.includes("\r\n") ? "CRLF" : "LF";
  const effectiveTabSize =
    tab.editorConfig?.tabWidth ?? tab.editorConfig?.indentSize ?? tabSize;
  const effectiveIndentStyle =
    tab.editorConfig?.indentStyle === "tab" ? "tab" : "space";
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const reviewWrite = useRef(Promise.resolve());
  const tabRef = useRef(tab);
  const relativePathRef = useRef<string | null>(null);
  const inlineEditRef = useRef<InlineEditState | null>(inlineEdit);
  const openInlineEditRef = useRef<(view: EditorView) => boolean>(() => false);
  const requestGhostTextRef = useRef<
    (view: EditorView, pos: number) => Promise<string | null>
  >(async () => null);
  /** Set while the component itself rewrites the doc, so the preview survives. */
  const inlineEditWriting = useRef(false);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  tabRef.current = tab;
  inlineEditRef.current = inlineEdit;

  const relativePath = projectPath ? projectRelativePath(projectPath, tab.path) : null;
  relativePathRef.current = relativePath;

  // Degraded buffers are never synced to a server: the content the editor holds
  // is not the content on disk, so every position would be wrong.
  const lspLanguage =
    tab.truncated || tab.longLines ? null : lspLanguageId(tab.name);
  const lspStatus = useLspStore((s) =>
    lspLanguage ? (s.statuses[lspLanguage] ?? null) : null,
  );
  const lspActive = usePrefsStore(
    (s) =>
      lspLanguage !== null
      && s.languageServer
      && !s.languageServerDisabled.includes(lspSettingGroup(lspLanguage)),
  );
  const lspContextRef = useRef<() => LspDocContext | null>(() => null);
  lspContextRef.current = () =>
    projectPath && lspLanguage
      ? { projectPath, path: tab.path, languageId: lspLanguage }
      : null;
  /** Stable across re-renders so CodeMirror extensions can capture it once. */
  const getLspContext = useRef(() => lspContextRef.current()).current;
  const lspChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lspNoticeShown = useRef<string | null>(null);
  const pendingReview = relativePath
    ? reviewTurns
        .map((turn) => ({
          turn,
          file: turn.files.find(
            (file) =>
              file.path.replace(/\\/g, "/").toLowerCase() ===
              relativePath.toLowerCase(),
          ),
        }))
        .find(
          ({ turn, file }) =>
            file && !reviewDecisions[reviewFileKey(turn.id, file.path)],
        )
    : null;
  const markerBaseline = reviewContext?.before ?? tab.savedContent;
  const breadcrumbParts = (relativePath ?? tab.name).split("/").filter(Boolean);

  const flushChange = () => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = null;
    const content = pendingContent.current;
    pendingContent.current = null;
    if (content !== null) onChangeRef.current(content);
  };

  const queueChange = (content: string) => {
    pendingContent.current = content;
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(flushChange, 140);
    if (diagnosticTimer.current) clearTimeout(diagnosticTimer.current);
    diagnosticTimer.current = setTimeout(() => {
      useDiagnosticsStore
        .getState()
        .replaceFile("editor", tab.path, analyzeEditorDocument(tab.path, content));
    }, 220);
    queueLspChange(content);
  };

  /**
   * Language servers only need the document for diagnostics — every on-demand
   * request ships the current text itself — so this can idle much longer than
   * the store sync.
   */
  const queueLspChange = (content: string) => {
    const context = lspContextRef.current();
    if (!context || !lspEnabledFor(context.languageId)) return;
    if (lspChangeTimer.current) clearTimeout(lspChangeTimer.current);
    lspChangeTimer.current = setTimeout(() => {
      lspChangeTimer.current = null;
      void ipc
        .lspChange(context.projectPath, context.path, context.languageId, content)
        .catch(() => undefined);
    }, 500);
  };

  const runGoToDefinition = (view: EditorView) => {
    const context = lspContextRef.current();
    if (!context || !lspEnabledFor(context.languageId)) return false;
    setLspNotice(null);
    void lspGoToDefinition(view, getLspContext).then((items) => {
      if (items.length === 0) return;
      setLspLocations({ kind: "definition", items });
    });
    return true;
  };

  const runFindReferences = (view: EditorView) => {
    const context = lspContextRef.current();
    if (!context || !lspEnabledFor(context.languageId)) return false;
    setLspNotice(null);
    void lspFindReferences(view, getLspContext).then((items) => {
      if (items.length === 0) {
        setLspNotice(t("lsp.noReferences"));
        return;
      }
      setLspLocations({ kind: "references", items });
    });
    return true;
  };

  const runRename = (view: EditorView) => {
    const context = lspContextRef.current();
    if (!context || !lspEnabledFor(context.languageId)) return false;
    if (tabRef.current.readOnly) return false;
    const selection = view.state.selection.main;
    const word = selection.empty
      ? view.state.wordAt(selection.head)
      : { from: selection.from, to: selection.to };
    setLspNotice(null);
    setRenamePrompt({
      value: word ? view.state.sliceDoc(word.from, word.to) : "",
      busy: false,
      error: null,
    });
    return true;
  };

  const lspKeyBindings = () => [
    ...(definitionKey ? [{ key: definitionKey, run: runGoToDefinition }] : []),
    ...(referencesKey ? [{ key: referencesKey, run: runFindReferences }] : []),
    ...(renameKey ? [{ key: renameKey, run: runRename }] : []),
  ];

  const submitRename = async () => {
    const view = viewRef.current;
    const prompt = renamePrompt;
    if (!view || !prompt) return;
    const name = prompt.value.trim();
    if (!name) return;
    setRenamePrompt({ ...prompt, busy: true, error: null });
    flushChange();
    const outcome = await lspRename(view, getLspContext, name);
    if (outcome.status === "applied") {
      setRenamePrompt(null);
      setLspNotice(
        outcome.skipped > 0
          ? t("lsp.renameAppliedPartial", {
              edits: outcome.edits,
              files: outcome.files,
              skipped: outcome.skipped,
            })
          : t("lsp.renameApplied", { edits: outcome.edits, files: outcome.files }),
      );
      return;
    }
    const message =
      outcome.status === "empty"
        ? t("lsp.renameEmpty")
        : outcome.status === "too-many-files"
          ? t("lsp.renameTooManyFiles", { files: outcome.files })
          : (outcome.message ?? t("lsp.renameFailed"));
    setRenamePrompt({ ...prompt, busy: false, error: message });
  };

  const persistInlineReviewDecision = async () => {
    const view = viewRef.current;
    const context = reviewContextRef.current;
    const currentProject = projectPath;
    if (!view || !context || !currentProject) return;
    const content = view.state.doc.toString();
    const remaining = getChunks(view.state)?.chunks.length ?? 0;
    flushChange();
    reviewWrite.current = reviewWrite.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await useReviewStore
            .getState()
            .writeMerged(currentProject, context.turnId, context.path, content);
          await useEditorStore.getState().refreshTabFromDisk(tab.path);
          if (remaining === 0) {
            await useReviewStore
              .getState()
              .resolveFile(currentProject, context.turnId, context.path);
          }
        } catch (error) {
          useEditorStore.setState({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    await reviewWrite.current;
  };

  const closeInlineEdit = (refocus = true) => {
    inlineAgent.cancel("edit");
    setInlineEdit(null);
    if (refocus) viewRef.current?.focus();
  };

  /** Open the Ctrl+K capsule over the selection, or the cursor line. */
  const openInlineEdit = (view: EditorView) => {
    if (view.state.readOnly || tabRef.current.readOnly) return false;
    if (inlineEditRef.current) {
      // A pending preview owns the range; forcing a second edit on top of it
      // would leave nothing to discard back to.
      setInlineEdit((current) =>
        current ? { ...current, error: t("editor.inlineEditPending") } : current,
      );
      return true;
    }
    const selection = view.state.selection.main;
    const firstLine = view.state.doc.lineAt(selection.from);
    const lastLine = view.state.doc.lineAt(
      selection.to > selection.from ? selection.to - 1 : selection.to,
    );
    const original = view.state.sliceDoc(selection.from, selection.to);
    const hostBox = host.current?.getBoundingClientRect();
    const coords = view.coordsAtPos(selection.from);
    const x =
      hostBox && coords
        ? Math.max(8, Math.min(coords.left - hostBox.left, hostBox.width - 348))
        : 8;
    const y = hostBox && coords ? Math.max(4, coords.bottom - hostBox.top + 6) : 8;

    setInlineEdit({
      x,
      y,
      from: selection.from,
      to: selection.to,
      original,
      firstLine: firstLine.number,
      lastLine: lastLine.number,
      hasSelection: !selection.empty,
      instruction: "",
      status: "input",
      error: !projectPath
        ? t("editor.inlineEditNoProject")
        : original.length > INLINE_EDIT_MAX_SELECTION
          ? t("editor.inlineEditTooLarge")
          : null,
    });
    return true;
  };
  openInlineEditRef.current = openInlineEdit;

  const runInlineEdit = async () => {
    const view = viewRef.current;
    const state = inlineEditRef.current;
    if (!view || !state) return;
    const instruction = state.instruction.trim();
    if (!instruction) return;
    if (!projectPath) {
      setInlineEdit((current) =>
        current ? { ...current, error: t("editor.inlineEditNoProject") } : current,
      );
      return;
    }

    const from = state.from;
    let to = state.to;
    let original: string;
    if (state.status === "preview") {
      // Retrying: put the captured text back first so the new instruction is
      // applied to the original region, and discard stays byte-accurate.
      original = state.original;
      inlineEditWriting.current = true;
      try {
        view.dispatch({
          changes: { from, to, insert: original },
          userEvent: "delete.inlineEdit",
        });
      } finally {
        inlineEditWriting.current = false;
      }
      to = from + original.length;
    } else {
      original = view.state.sliceDoc(from, to);
    }
    if (original.length > INLINE_EDIT_MAX_SELECTION) {
      setInlineEdit((current) =>
        current ? { ...current, error: t("editor.inlineEditTooLarge") } : current,
      );
      return;
    }
    setInlineEdit((current) =>
      current
        ? { ...current, status: "running", error: null, from, to, original }
        : current,
    );

    const doc = view.state.doc;
    const prompt = buildInlineEditPrompt({
      path: relativePath ?? tab.name,
      language: languageNameRef.current,
      selection: original,
      before: tailLines(doc.sliceString(0, from), INLINE_EDIT_CONTEXT_LINES),
      after: headLines(doc.sliceString(to, doc.length), INLINE_EDIT_CONTEXT_LINES),
      instruction,
    });

    try {
      const reply = await inlineAgent.run(projectPath, prompt, "edit");
      const extracted = extractCodeBlock(reply);
      if (extracted === null || extracted.length > INLINE_EDIT_MAX_RESULT) {
        throw new Error(t("editor.inlineEditEmpty"));
      }
      const replacement = normalizeInlineResult(original, extracted);
      if (replacement === original) throw new Error(t("editor.inlineEditUnchanged"));

      const current = viewRef.current;
      if (!current || inlineEditRef.current?.status !== "running") return;
      inlineEditWriting.current = true;
      try {
        current.dispatch({
          changes: { from, to, insert: replacement },
          selection: { anchor: from + replacement.length },
          userEvent: "input.inlineEdit",
          scrollIntoView: true,
        });
      } finally {
        inlineEditWriting.current = false;
      }
      // The instruction field was disabled while the turn ran, so focus is on
      // the document body by now. Put it back in the editor: that is where the
      // Enter/Escape accept and discard shortcuts listen.
      current.focus();
      setInlineEdit((value) =>
        value
          ? {
              ...value,
              status: "preview",
              error: null,
              from,
              to: from + replacement.length,
              original,
            }
          : value,
      );
    } catch (error) {
      if (error instanceof InlineAgentCancelled) return;
      setInlineEdit((value) =>
        value
          ? {
              ...value,
              status: "input",
              error: error instanceof Error ? error.message : String(error),
            }
          : value,
      );
    }
  };

  const acceptInlineEdit = () => {
    flushChange();
    closeInlineEdit();
  };

  const discardInlineEdit = () => {
    const view = viewRef.current;
    const state = inlineEditRef.current;
    if (view && state?.status === "preview" && state.to <= view.state.doc.length) {
      inlineEditWriting.current = true;
      try {
        view.dispatch({
          changes: { from: state.from, to: state.to, insert: state.original },
          selection: { anchor: state.from + state.original.length },
          userEvent: "delete.inlineEdit",
        });
      } finally {
        inlineEditWriting.current = false;
      }
      flushChange();
    }
    closeInlineEdit();
  };

  /** Build a completion suggestion for the ghost-text extension. */
  const requestGhostText = async (view: EditorView, pos: number) => {
    const project = useProjectStore.getState().current?.path;
    if (!project) return null;
    const displayPath = relativePathRef.current ?? tabRef.current.name;
    const doc = view.state.doc;
    if (doc.length > GHOST_TEXT_MAX_DOC) return null;
    const beforeAll = doc.sliceString(0, pos);
    if (
      !shouldRequestGhostText({
        enabled: usePrefsStore.getState().ghostText,
        hasSelection: !view.state.selection.main.empty,
        composing: view.composing,
        readOnly: view.state.readOnly || tabRef.current.readOnly,
        charBefore: beforeAll.slice(-1),
        charAfter: doc.sliceString(pos, Math.min(doc.length, pos + 1)),
      })
    ) {
      return null;
    }
    const before = tailLines(beforeAll, GHOST_TEXT_PREFIX_LINES);
    const after = headLines(doc.sliceString(pos, doc.length), GHOST_TEXT_SUFFIX_LINES);
    try {
      const reply = await inlineAgent.run(
        project,
        buildGhostTextPrompt({
          path: displayPath,
          language: languageNameRef.current,
          before,
          after,
        }),
        "ghost",
      );
      const extracted = extractCodeBlock(reply);
      return extracted ? sanitizeGhostText(before, extracted) : null;
    } catch {
      // Completion is best-effort; a missing harness must not raise an error UI.
      return null;
    }
  };
  requestGhostTextRef.current = requestGhostText;

  const refreshCapsule = (view: EditorView) => {
    if (view.composing) {
      setCapsule(null);
      return;
    }
    const meta = selectionMeta(view);
    if (!meta?.endCoords) {
      setCapsule(null);
      return;
    }
    const hostBox = host.current?.getBoundingClientRect();
    if (!hostBox) {
      setCapsule(null);
      return;
    }
    setCapsule({
      x: Math.min(Math.max(8, meta.endCoords.right - hostBox.left + 8), hostBox.width - 88),
      y: Math.max(4, meta.endCoords.top - hostBox.top - 28),
      text: meta.text,
      firstLine: meta.firstLine,
      lastLine: meta.lastLine,
      menuOpen: false,
    });
  };

  const refreshBreadcrumb = (view: EditorView) => {
    const scopes = scopeLinesAt(view.state, view.state.selection.main.head);
    setBreadcrumbSymbol(scopes.at(-1)?.symbol ?? null);
  };

  const refreshStickyScopes = (view: EditorView) => {
    setStickyScopes(scopeLinesAt(view.state, view.viewport.from));
  };

  useEffect(() => {
    let cancelled = false;
    if (!projectPath || !pendingReview?.file) {
      setReviewContext(null);
      return;
    }
    const turnId = pendingReview.turn.id;
    const path = pendingReview.file.path;
    void ipc
      .ckptFileContents(projectPath, turnId, path)
      .then((contents) => {
        if (!cancelled) setReviewContext({ turnId, path, before: contents.before });
      })
      .catch(() => {
        if (!cancelled) setReviewContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingReview?.file?.path, pendingReview?.turn.id, projectPath]);

  useEffect(() => {
    let alive = true;
    let view: EditorView | null = null;
    let unsubscribeDiagnostics: (() => void) | null = null;
    const degrade = tab.truncated || tab.longLines;
    hashRef.current = tab.hash;
    revisionRef.current = tab.revision ?? 0;

    async function mount() {
      const language = !degrade ? resolveEditorLanguage(tab.name, tab.content) : null;
      languageNameRef.current = language?.name ?? null;
      const languageSupport = language ? await language.load().catch(() => null) : null;
      if (!alive || !host.current) return;
      const initialReview = reviewContextRef.current;

      const state = EditorState.create({
        doc: tab.content,
        extensions: [
          basicSetup,
          autocompletion({
            // The LSP source resolves first when a server is live; the
            // heuristic source always contributes so completion still works
            // for file types and projects with no server installed.
            override: [lspCompletionSource(getLspContext), glyphraCompletionSource],
            activateOnTyping: true,
            maxRenderedOptions: 80,
          }),
          lspHoverExtension(getLspContext),
          lintGutter(),
          EditorState.lineSeparator.of(lineEnding === "CRLF" ? "\r\n" : "\n"),
          keymapCompartment.current.of(
            // Glyphra bindings come first so they win the shared keys; each one
            // returns false when it does not apply, letting the VS Code keymap
            // (Ctrl+L select-line, for instance) take over.
            keymap.of([
              ...(inlineEditKey
                ? [
                    {
                      key: inlineEditKey,
                      run: (current: EditorView) => openInlineEditRef.current(current),
                    },
                  ]
                : []),
              {
                key: "Mod-s",
                run: () => {
                  flushChange();
                  onSaveRef.current();
                  return true;
                },
              },
              {
                key: "Mod-l",
                run: (current) => {
                  const meta = selectionMeta(current);
                  if (!meta) return false;
                  attachSelectionToAgent(tabRef.current, meta);
                  return true;
                },
              },
              ...lspKeyBindings(),
              ...baseKeymapWithout(inlineEditKey),
            ]),
          ),
          ghostTextExtension({
            enabled: () =>
              usePrefsStore.getState().ghostText && !tabRef.current.readOnly,
            delayMs: () => usePrefsStore.getState().ghostTextDelayMs,
            request: (current, pos) => requestGhostTextRef.current(current, pos),
            onAbandon: () => inlineAgent.cancel("ghost"),
          }),
          EditorState.readOnly.of(tab.readOnly || degrade),
          EditorView.editable.of(!(tab.readOnly || degrade)),
          languageSupport ?? [],
          prefsCompartment.current.of(
            editorChrome(
              fontSize,
              wordWrap,
              showLineNumbers,
              effectiveTabSize,
              effectiveIndentStyle,
            ),
          ),
          themeCompartment.current.of(editorThemeExtensions(theme, customTheme)),
          visualsCompartment.current.of(
            editorVisualExtensions({
              bracketPairColorization,
              indentGuides,
              minimap,
              tabSize: effectiveTabSize,
            }),
          ),
          modifiedCodeCompartment.current.of(
            initialReview
              ? inlineReviewExtension(
                  initialReview.before,
                  t("review.acceptHunk"),
                  t("review.rejectHunk"),
                  persistInlineReviewDecision,
                )
              : modifiedCodeMarkerExtension(tab.savedContent, t("editor.modifiedCode")),
          ),
          imeSafeUpdateListener(queueChange),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !inlineEditWriting.current) {
              // Something else edited the buffer (typing, disk sync, an agent
              // write). The recorded preview range is now unreliable, so keep
              // the text and retire the discard affordance.
              if (inlineEditRef.current?.status === "preview") setInlineEdit(null);
            }
            if (update.selectionSet || update.focusChanged || update.docChanged) {
              refreshCapsule(update.view);
            }
            if (update.selectionSet || update.docChanged) {
              refreshBreadcrumb(update.view);
              if (focusedRef.current) {
                useEditorStore.getState().setCursor(readCursor(update.state));
              }
            }
            if (update.viewportChanged || update.docChanged) {
              refreshStickyScopes(update.view);
            }
          }),
        ],
      });

      view = new EditorView({ state, parent: host.current });
      viewRef.current = view;
      setEditorView(view);
      refreshBreadcrumb(view);
      refreshStickyScopes(view);
      const syncDiagnostics = () => {
        if (!view) return;
        const path = tab.path.replace(/\\/g, "/").toLowerCase();
        const diagnostics = useDiagnosticsStore
          .getState()
          .diagnostics.filter(
            (item) => item.path.replace(/\\/g, "/").toLowerCase() === path,
          );
        view.dispatch(
          setDiagnostics(view.state, codeMirrorDiagnostics(view.state, diagnostics)),
        );
      };
      unsubscribeDiagnostics = useDiagnosticsStore.subscribe(syncDiagnostics);
      useDiagnosticsStore
        .getState()
        .replaceFile(
          "editor",
          tab.path,
          analyzeEditorDocument(tab.path, tab.content),
        );
      syncDiagnostics();
      if (focusedRef.current) {
        useEditorStore.getState().setCursor(readCursor(view.state));
        useEditorStore.getState().setDocInfo({
          languageName: language?.name ?? null,
          eol: lineEnding,
          indentStyle: effectiveIndentStyle,
          indentSize: effectiveTabSize,
          editorConfigIndent:
            tab.editorConfig?.indentStyle != null ||
            tab.editorConfig?.indentSize != null ||
            tab.editorConfig?.tabWidth != null,
        });
      }
    }

    void mount();
    return () => {
      alive = false;
      flushChange();
      if (diagnosticTimer.current) clearTimeout(diagnosticTimer.current);
      unsubscribeDiagnostics?.();
      view?.destroy();
      if (viewRef.current === view) viewRef.current = null;
      setEditorView((current) => (current === view ? null : current));
      setCapsule(null);
      setBreadcrumbSymbol(null);
      setStickyScopes([]);
      if (focusedRef.current) {
        useEditorStore.getState().setCursor(null);
        useEditorStore.getState().setDocInfo(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.name, tab.path, tab.readOnly, tab.truncated, tab.longLines, lineEnding]);

  useEffect(() => {
    // Lazy start: the server for this language only spawns once a matching file
    // is actually open, and every open document is released on tab close.
    if (!projectPath || !lspLanguage || !lspActive) return;
    let cancelled = false;
    const path = tab.path;
    const languageId = lspLanguage;
    void (async () => {
      try {
        await ensureLspListeners();
        if (cancelled) return;
        await ipc.lspOpen(projectPath, path, languageId, tabRef.current.content);
      } catch {
        // Failures arrive as an `lsp-status` event with the install hint.
      }
    })();
    return () => {
      cancelled = true;
      if (lspChangeTimer.current) {
        clearTimeout(lspChangeTimer.current);
        lspChangeTimer.current = null;
      }
      setLspLocations(null);
      setRenamePrompt(null);
      setLspNotice(null);
      void ipc.lspClose(projectPath, path, languageId).catch(() => undefined);
    };
  }, [projectPath, lspLanguage, lspActive, tab.path]);

  useEffect(() => {
    // Surface a missing server once per message, not on every tab switch: the
    // hint names the executable to install, and repeating it is noise.
    if (!lspActive || lspStatus?.state !== "unavailable" || !lspStatus.message) return;
    if (lspNoticeShown.current === lspStatus.message) return;
    lspNoticeShown.current = lspStatus.message;
    setLspNotice(lspStatus.message);
  }, [lspActive, lspStatus?.state, lspStatus?.message]);

  useEffect(() => {
    // Pull in writes that did not come from this view: a disk sync (new hash)
    // or an external rewrite such as an LSP rename (new revision).
    const view = viewRef.current;
    if (!view) return;
    const revision = tab.revision ?? 0;
    if (hashRef.current === tab.hash && revisionRef.current === revision) return;
    hashRef.current = tab.hash;
    revisionRef.current = revision;
    const current = view.state.doc.toString();
    if (current === tab.content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: tab.content },
    });
  }, [tab.hash, tab.revision, tab.content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!focused || !view) return;
    useEditorStore.getState().setCursor(readCursor(view.state));
    useEditorStore.getState().setDocInfo({
      languageName: languageNameRef.current,
      eol: lineEnding,
      indentStyle: effectiveIndentStyle,
      indentSize: effectiveTabSize,
      editorConfigIndent:
        tab.editorConfig?.indentStyle != null ||
        tab.editorConfig?.indentSize != null ||
        tab.editorConfig?.tabWidth != null,
    });
  }, [
    effectiveIndentStyle,
    effectiveTabSize,
    focused,
    lineEnding,
    tab.editorConfig?.indentSize,
    tab.editorConfig?.indentStyle,
    tab.editorConfig?.tabWidth,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal || reveal.path !== tab.path) return;
    const lineNumber = Math.min(Math.max(1, reveal.line), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    const column = Math.min(Math.max(1, reveal.column), line.length + 1);
    const pos = Math.min(line.from + column - 1, line.to);
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
    useEditorStore.getState().clearReveal(reveal.token);
  }, [reveal, tab.path]);

  useEffect(() => {
    // Flush before a pointer action can switch/close the tab, while keeping
    // ordinary typing off the global React/Zustand render path.
    window.addEventListener("pointerdown", flushChange, true);
    return () => window.removeEventListener("pointerdown", flushChange, true);
  });

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(
        editorThemeExtensions(theme, customTheme),
      ),
    });
  }, [customTheme, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: keymapCompartment.current.reconfigure(
        keymap.of([
          ...(inlineEditKey
            ? [
                {
                  key: inlineEditKey,
                  run: (current: EditorView) => openInlineEditRef.current(current),
                },
              ]
            : []),
          {
            key: "Mod-s",
            run: () => {
              flushChange();
              onSaveRef.current();
              return true;
            },
          },
          {
            key: "Mod-l",
            run: (current: EditorView) => {
              const meta = selectionMeta(current);
              if (!meta) return false;
              attachSelectionToAgent(tabRef.current, meta);
              return true;
            },
          },
          ...lspKeyBindings(),
          ...baseKeymapWithout(inlineEditKey),
        ]),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineEditKey, definitionKey, referencesKey, renameKey]);

  useEffect(() => {
    if (inlineEdit?.status !== "preview") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      // Only claim the keys while focus is still inside this editor pane —
      // the agent composer and dialogs need their own Enter and Escape.
      const target = event.target;
      if (target instanceof Node && !host.current?.contains(target)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        acceptInlineEdit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        discardInlineEdit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineEdit?.status]);

  useEffect(() => {
    // A tab switch or unmount leaves no way to accept or discard, so retire the
    // capsule and stop any request it still owns. Text already spliced in stays
    // — it is an ordinary unsaved edit at that point.
    return () => {
      inlineAgent.cancel("edit");
      setInlineEdit(null);
    };
  }, [tab.path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const extension = reviewContext
      ? inlineReviewExtension(
          reviewContext.before,
          t("review.acceptHunk"),
          t("review.rejectHunk"),
          persistInlineReviewDecision,
        )
      : modifiedCodeMarkerExtension(tab.savedContent, t("editor.modifiedCode"));
    view.dispatch({
      effects: modifiedCodeCompartment.current.reconfigure(extension),
    });
  }, [markerBaseline, reviewContext?.turnId, t]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: prefsCompartment.current.reconfigure(
        editorChrome(
          fontSize,
          wordWrap,
          showLineNumbers,
          effectiveTabSize,
          effectiveIndentStyle,
        ),
      ),
    });
  }, [
    effectiveIndentStyle,
    effectiveTabSize,
    fontSize,
    showLineNumbers,
    tabSize,
    wordWrap,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: visualsCompartment.current.reconfigure(
        editorVisualExtensions({
          bracketPairColorization,
          indentGuides,
          minimap,
          tabSize: effectiveTabSize,
        }),
      ),
    });
  }, [
    bracketPairColorization,
    effectiveTabSize,
    indentGuides,
    minimap,
  ]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const view = viewRef.current;
      if (!view || !focusedRef.current) return;
      const command = (event as CustomEvent<EditorCommand>).detail;
      if (command === "undo") undo(view);
      if (command === "redo") redo(view);
      if (command === "selectAll") selectAll(view);
      if (command === "goToDefinition") runGoToDefinition(view);
      if (command === "findReferences") runFindReferences(view);
      // Rename opens its own input, so it keeps focus rather than handing it
      // straight back to the document.
      if (command === "rename") {
        runRename(view);
        return;
      }
      view.focus();
    };
    window.addEventListener(EDITOR_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(EDITOR_COMMAND_EVENT, onCommand);
  }, []);

  const editable = !tab.readOnly && !tab.truncated && !tab.longLines;
  const menuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          id: "undo",
          label: t("menu.undo"),
          shortcut: "Ctrl+Z",
          icon: <Undo2 className="size-3.5" />,
          disabled: !editable,
          action: () => {
            const view = viewRef.current;
            if (view) undo(view);
          },
        },
        {
          id: "redo",
          label: t("menu.redo"),
          shortcut: "Ctrl+Y",
          icon: <Redo2 className="size-3.5" />,
          disabled: !editable,
          action: () => {
            const view = viewRef.current;
            if (view) redo(view);
          },
        },
        { id: "history-separator", separator: true },
        {
          id: "cut",
          label: t("menu.cut"),
          shortcut: "Ctrl+X",
          icon: <Scissors className="size-3.5" />,
          disabled: !editable || !contextMenu.text,
          action: async () => {
            const view = viewRef.current;
            if (!view || !contextMenu.text) return;
            await copyText(contextMenu.text);
            view.dispatch({ changes: { from: contextMenu.from, to: contextMenu.to } });
            view.focus();
          },
        },
        {
          id: "copy",
          label: t("menu.copy"),
          shortcut: "Ctrl+C",
          icon: <Copy className="size-3.5" />,
          disabled: !contextMenu.text,
          action: () => copyText(contextMenu.text),
        },
        {
          id: "paste",
          label: t("menu.paste"),
          shortcut: "Ctrl+V",
          icon: <ClipboardPaste className="size-3.5" />,
          disabled: !editable,
          action: async () => {
            const view = viewRef.current;
            if (!view) return;
            const text = await readClipboardText();
            if (!text) return;
            view.dispatch({
              changes: { from: contextMenu.from, to: contextMenu.to, insert: text },
              selection: { anchor: contextMenu.from + text.length },
            });
            view.focus();
          },
        },
        {
          id: "select-all",
          label: t("menu.selectAll"),
          shortcut: "Ctrl+A",
          icon: <TextSelect className="size-3.5" />,
          action: () => {
            const view = viewRef.current;
            if (view) selectAll(view);
          },
        },
        { id: "agent-separator", separator: true },
        {
          id: "attach-agent",
          label: t("agent.attachCodeSelection"),
          icon: <MessageSquarePlus className="size-3.5" />,
          disabled: !contextMenu.text,
          action: () => {
            if (!contextMenu.text) return;
            attachSelectionToAgent(tab, contextMenu);
          },
        },
      ]
    : [];

  return (
    <>
      {breadcrumbs && (
        <nav
          aria-label={t("editor.breadcrumbs")}
          className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b border-line/70 bg-panel/45 px-2 font-mono text-[10px] text-ink-3"
        >
          {breadcrumbParts.map((part, index) => (
            <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && (
                <span aria-hidden className="text-ink-3/60">
                  ›
                </span>
              )}
              <span className="max-w-40 truncate">{part}</span>
            </span>
          ))}
          {breadcrumbSymbol && (
            <>
              <span aria-hidden className="text-ink-3/60">
                ›
              </span>
              <span className="truncate text-ink-2">{breadcrumbSymbol}</span>
            </>
          )}
        </nav>
      )}
      {stickyScroll && stickyScopes.length > 0 && (
        <div
          aria-label={t("editor.stickyScope")}
          className="z-[5] shrink-0 border-b border-line/70 bg-panel/95 shadow-sm"
        >
          {stickyScopes.map((scope) => (
            <button
              key={`${scope.line}-${scope.from}`}
              type="button"
              title={scope.label}
              onClick={() => {
                const view = viewRef.current;
                if (!view) return;
                view.dispatch({
                  selection: { anchor: scope.from },
                  effects: EditorView.scrollIntoView(scope.from, { y: "start" }),
                });
                view.focus();
              }}
              className="block h-5 w-full truncate px-3 text-left font-mono text-[10px] text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              <span className="mr-2 select-none text-ink-3/60">{scope.line}</span>
              {scope.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={host}
        className="relative min-h-0 flex-1"
        onFocusCapture={onFocus}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const view = viewRef.current;
          if (!view) return;
          let selection = view.state.selection.main;
          const clicked = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (
            clicked != null &&
            (selection.empty || clicked < selection.from || clicked > selection.to)
          ) {
            view.dispatch({ selection: { anchor: clicked } });
            selection = view.state.selection.main;
          }
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            from: selection.from,
            to: selection.to,
            text: view.state.sliceDoc(selection.from, selection.to),
            firstLine: view.state.doc.lineAt(selection.from).number,
            lastLine: view.state.doc.lineAt(
              selection.to > selection.from ? selection.to - 1 : selection.to,
            ).number,
          });
        }}
      >
        {minimap && editorView && (
          <EditorMinimap view={editorView} revision={tab.content} />
        )}
        {inlineEdit && (
          <InlineEditPanel
            x={inlineEdit.x}
            y={inlineEdit.y}
            status={inlineEdit.status}
            instruction={inlineEdit.instruction}
            error={inlineEdit.error}
            hint={
              inlineEdit.hasSelection
                ? t("editor.inlineEditSelectionHint", {
                    first: inlineEdit.firstLine,
                    last: inlineEdit.lastLine,
                  })
                : t("editor.inlineEditCursorHint", { line: inlineEdit.firstLine })
            }
            onInstructionChange={(value) =>
              setInlineEdit((current) =>
                current ? { ...current, instruction: value } : current,
              )
            }
            onSubmit={() => void runInlineEdit()}
            onCancel={() => closeInlineEdit()}
            onAccept={acceptInlineEdit}
            onDiscard={discardInlineEdit}
          />
        )}
        {renamePrompt && (
          <LspRenamePanel
            value={renamePrompt.value}
            busy={renamePrompt.busy}
            error={renamePrompt.error}
            onChange={(value) =>
              setRenamePrompt((current) => (current ? { ...current, value } : current))
            }
            onSubmit={() => void submitRename()}
            onCancel={() => {
              setRenamePrompt(null);
              viewRef.current?.focus();
            }}
          />
        )}
        {lspLocations && (
          <LspLocationsPanel
            kind={lspLocations.kind}
            items={lspLocations.items}
            projectPath={projectPath}
            onPick={(location) => {
              setLspLocations(null);
              void revealLocation(location);
            }}
            onClose={() => {
              setLspLocations(null);
              viewRef.current?.focus();
            }}
          />
        )}
        {!lspLocations && lspNotice && (
          <LspNotice message={lspNotice} onClose={() => setLspNotice(null)} />
        )}
        {capsule && (
          <div
            className="pointer-events-auto absolute z-20"
            style={{ left: capsule.x, top: capsule.y }}
          >
            <div className="glass-float pop-in relative flex items-center rounded-full border border-line/80 shadow-sm">
              <button
                type="button"
                className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-ink-2 hover:bg-hover"
                title={`${t("editor.askAgent")} · Ctrl+L`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  setCapsule((current) =>
                    current ? { ...current, menuOpen: !current.menuOpen } : current,
                  )
                }
              >
                <Sparkles className="size-3 text-accent" />
                {t("editor.askAgent")}
              </button>
              {capsule.menuOpen && (
                <div className="glass-float absolute left-0 top-[calc(100%+6px)] min-w-[148px] overflow-hidden rounded-xl border border-line py-1">
                  {(
                    [
                      ["review", t("editor.agentReview")],
                      ["explain", t("editor.agentExplain")],
                      ["rewrite", t("editor.agentRewrite")],
                      ["test", t("editor.agentTest")],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-[11px] text-ink-2 hover:bg-hover"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        attachSelectionToAgent(tab, capsule, action);
                        setCapsule(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
