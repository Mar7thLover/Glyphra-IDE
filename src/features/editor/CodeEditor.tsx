import { indentUnit } from "@codemirror/language";
import { redo, selectAll, undo } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { basicSetup } from "codemirror";
import { ClipboardPaste, Copy, MessageSquarePlus, Redo2, Scissors, TextSelect, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { copyText, readClipboardText } from "@/lib/clipboard";
import type { EditorTab } from "@/lib/stores/editorStore";
import {
  EDITOR_COMMAND_EVENT,
  type EditorCommand,
} from "@/lib/editorCommands";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { focusAgentComposer, useComposerDraft } from "@/lib/stores/composerStore";
import { useUiStore } from "@/lib/stores/uiStore";

import { editorThemeExtensions } from "./cmTheme";
import { resolveEditorLanguage } from "./editorLanguage";

interface CodeEditorProps {
  tab: EditorTab;
  onChange: (content: string) => void;
  onSave: () => void;
}

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

export default function CodeEditor({ tab, onChange, onSave }: CodeEditorProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    from: number;
    to: number;
    text: string;
    firstLine: number;
    lastLine: number;
  } | null>(null);
  const themeCompartment = useRef(new Compartment());
  const prefsCompartment = useRef(new Compartment());
  const theme = useUiStore((s) => s.theme);
  const fontSize = usePrefsStore((s) => s.fontSize);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const wordWrap = usePrefsStore((s) => s.wordWrap);
  const showLineNumbers = usePrefsStore((s) => s.lineNumbers);
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

  useEffect(() => {
    let alive = true;
    let view: EditorView | null = null;
    const degrade = tab.truncated || tab.longLines;

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
          ]),
          EditorState.readOnly.of(tab.readOnly || degrade),
          EditorView.editable.of(!(tab.readOnly || degrade)),
          languageSupport ?? [],
          prefsCompartment.current.of(
            editorChrome(fontSize, wordWrap, showLineNumbers, tabSize),
          ),
          themeCompartment.current.of(editorThemeExtensions(theme)),
          imeSafeUpdateListener(queueChange),
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.name, tab.path, tab.readOnly, tab.truncated, tab.longLines]);

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
            const lines = contextMenu.firstLine === contextMenu.lastLine
              ? `L${contextMenu.firstLine}`
              : `L${contextMenu.firstLine}-L${contextMenu.lastLine}`;
            useComposerDraft.getState().addReference({
              kind: "code",
              label: `${tab.name}:${lines}`,
              path: tab.path,
              content: contextMenu.text,
            });
            useUiStore.getState().openAgent();
            focusAgentComposer();
          },
        },
      ]
    : [];

  return (
    <>
      <div
        ref={host}
        className="min-h-0 flex-1"
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
      />
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
