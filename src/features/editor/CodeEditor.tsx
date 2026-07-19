import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { useEffect, useRef } from "react";

import { useUiStore } from "@/lib/stores/uiStore";

import type { EditorTab } from "@/lib/stores/editorStore";

import { editorThemeExtensions } from "./cmTheme";

interface CodeEditorProps {
  tab: EditorTab;
  onChange: (content: string) => void;
  onSave: () => void;
}

export default function CodeEditor({ tab, onChange, onSave }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const theme = useUiStore((s) => s.theme);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Mount / remount when the buffer identity or degrade mode changes.
  useEffect(() => {
    let alive = true;
    let view: EditorView | null = null;
    const degrade = tab.truncated || tab.longLines;

    async function mount() {
      const language =
        !degrade ? LanguageDescription.matchFilename(languages, tab.name) : null;
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
          EditorView.lineWrapping,
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
    // Intentionally omit `theme` — theme swaps use the compartment below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.name, tab.path, tab.readOnly, tab.truncated, tab.longLines]);

  // Hot-swap chrome + syntax colors without destroying the document / undo stack.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(editorThemeExtensions(theme)),
    });
  }, [theme]);

  return <div ref={host} className="min-h-0 flex-1" />;
}
