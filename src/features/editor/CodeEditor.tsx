import { indentUnit, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import type { EditorTab } from "@/lib/stores/editorStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useUiStore } from "@/lib/stores/uiStore";

import { editorThemeExtensions } from "./cmTheme";

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

export default function CodeEditor({ tab, onChange, onSave }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const prefsCompartment = useRef(new Compartment());
  const theme = useUiStore((s) => s.theme);
  const fontSize = usePrefsStore((s) => s.fontSize);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const wordWrap = usePrefsStore((s) => s.wordWrap);
  const showLineNumbers = usePrefsStore((s) => s.lineNumbers);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    let alive = true;
    let view: EditorView | null = null;
    const degrade = tab.truncated || tab.longLines;

    async function mount() {
      const language = !degrade ? LanguageDescription.matchFilename(languages, tab.name) : null;
      const languageSupport = language ? await language.load().catch(() => null) : null;
      if (!alive || !host.current) return;

      const state = EditorState.create({
        doc: tab.content,
        extensions: [
          basicSetup,
          keymap.of([
            ...vscodeKeymap,
            {
              key: "Mod-s",
              run: () => {
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
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      });

      view = new EditorView({ state, parent: host.current });
      viewRef.current = view;
    }

    void mount();
    return () => {
      alive = false;
      view?.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.name, tab.path, tab.readOnly, tab.truncated, tab.longLines]);

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

  return <div ref={host} className="min-h-0 flex-1" />;
}
