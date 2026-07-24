import { indentUnit } from "@codemirror/language";
import { redo, selectAll, undo } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
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
import { copyText, readClipboardText } from "@/lib/clipboard";
import type { EditorTab } from "@/lib/stores/editorStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import {
  EDITOR_COMMAND_EVENT,
  type EditorCommand,
} from "@/lib/editorCommands";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { focusAgentComposer, useComposerDraft } from "@/lib/stores/composerStore";
import { useUiStore } from "@/lib/stores/uiStore";

import { editorThemeExtensions } from "./cmTheme";
import { resolveEditorLanguage } from "./editorLanguage";
import { modifiedCodeMarkerExtension } from "./modifiedCodeMarkers";

interface CodeEditorProps {
  tab: EditorTab;
  onChange: (content: string) => void;
  onSave: () => void;
}

type AgentAction = "review" | "explain" | "rewrite" | "test";

const AGENT_PROMPTS: Record<AgentAction, string> = {
  review: "Review this selection for correctness, edge cases, and regressions.",
  explain: "Explain this selection clearly and concisely.",
  rewrite: "Rewrite this selection with clearer structure while preserving behavior.",
  test: "Add or suggest focused tests for this selection.",
};

function editorChrome(fontSize: number, wordWrap: boolean, showLineNumbers: boolean, tabSize: number) {
  return [
    EditorView.theme({
      "&": { fontSize: `${fontSize}px` },
      ".cm-content": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
      ".cm-gutters": {
        fontSize: `${Math.max(10, fontSize - 1)}px`,
        ...(showLineNumbers ? {} : { display: "none" }),
      },
    }),
    indentUnit.of(" ".repeat(tabSize)),
    EditorState.tabSize.of(tabSize),
    wordWrap ? EditorView.lineWrapping : [],
  ];
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

export default function CodeEditor({ tab, onChange, onSave }: CodeEditorProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hashRef = useRef(tab.hash);
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
  const themeCompartment = useRef(new Compartment());
  const prefsCompartment = useRef(new Compartment());
  const modifiedCodeCompartment = useRef(new Compartment());
  const theme = useUiStore((s) => s.theme);
  const fontSize = usePrefsStore((s) => s.fontSize);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const wordWrap = usePrefsStore((s) => s.wordWrap);
  const showLineNumbers = usePrefsStore((s) => s.lineNumbers);
  const reveal = useEditorStore((s) => s.reveal);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

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
  };

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

  useEffect(() => {
    let alive = true;
    let view: EditorView | null = null;
    const degrade = tab.truncated || tab.longLines;
    hashRef.current = tab.hash;

    async function mount() {
      const language = !degrade ? resolveEditorLanguage(tab.name, tab.content) : null;
      const languageSupport = language ? await language.load().catch(() => null) : null;
      if (!alive || !host.current) return;

      const state = EditorState.create({
        doc: tab.content,
        extensions: [
          basicSetup,
          EditorState.lineSeparator.of(tab.content.includes("\r\n") ? "\r\n" : "\n"),
          keymap.of([
            ...vscodeKeymap,
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
                attachSelectionToAgent(tab, meta);
                return true;
              },
            },
          ]),
          EditorState.readOnly.of(tab.readOnly || degrade),
          EditorView.editable.of(!(tab.readOnly || degrade)),
          languageSupport ?? [],
          prefsCompartment.current.of(
            editorChrome(fontSize, wordWrap, showLineNumbers, tabSize),
          ),
          themeCompartment.current.of(editorThemeExtensions(theme)),
          modifiedCodeCompartment.current.of(
            modifiedCodeMarkerExtension(tab.savedContent, t("editor.modifiedCode")),
          ),
          imeSafeUpdateListener(queueChange),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.focusChanged || update.docChanged) {
              refreshCapsule(update.view);
            }
          }),
        ],
      });

      view = new EditorView({ state, parent: host.current });
      viewRef.current = view;
    }

    void mount();
    return () => {
      alive = false;
      flushChange();
      view?.destroy();
      if (viewRef.current === view) viewRef.current = null;
      setCapsule(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.name, tab.path, tab.readOnly, tab.truncated, tab.longLines]);

  useEffect(() => {
    // External disk sync: only rewrite the CM doc when the saved hash changes.
    const view = viewRef.current;
    if (!view) return;
    if (hashRef.current === tab.hash) return;
    hashRef.current = tab.hash;
    const current = view.state.doc.toString();
    if (current === tab.content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: tab.content },
    });
  }, [tab.hash, tab.content]);

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
      effects: themeCompartment.current.reconfigure(editorThemeExtensions(theme)),
    });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: modifiedCodeCompartment.current.reconfigure(
        modifiedCodeMarkerExtension(tab.savedContent, t("editor.modifiedCode")),
      ),
    });
  }, [tab.savedContent, t]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: prefsCompartment.current.reconfigure(
        editorChrome(fontSize, wordWrap, showLineNumbers, tabSize),
      ),
    });
  }, [fontSize, wordWrap, showLineNumbers, tabSize]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const view = viewRef.current;
      if (!view) return;
      const command = (event as CustomEvent<EditorCommand>).detail;
      if (command === "undo") undo(view);
      if (command === "redo") redo(view);
      if (command === "selectAll") selectAll(view);
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
      <div
        ref={host}
        className="relative min-h-0 flex-1"
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
