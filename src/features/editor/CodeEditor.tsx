import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { useEffect, useRef } from "react";

import { useUiStore } from "@/lib/stores/uiStore";

import type { EditorTab } from "@/lib/stores/editorStore";

interface CodeEditorProps {
  tab: EditorTab;
  onChange: (content: string) => void;
}

export default function CodeEditor({ tab, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    let alive = true;
    let view: EditorView | null = null;

    async function mount() {
      const language = LanguageDescription.matchFilename(languages, tab.name);
      const languageSupport = language ? await language.load().catch(() => null) : null;
      if (!alive || !host.current) return;

      const state = EditorState.create({
        doc: tab.content,
        extensions: [
          basicSetup,
          keymap.of(vscodeKeymap),
          EditorState.readOnly.of(tab.readOnly),
          EditorView.editable.of(!tab.readOnly),
          languageSupport ?? [],
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: "transparent",
                color: "var(--ink-1)",
                fontSize: "13px",
              },
              ".cm-scroller": {
                fontFamily: "var(--font-mono)",
                lineHeight: "1.55",
              },
              ".cm-gutters": {
                backgroundColor: "transparent",
                color: "var(--ink-3)",
                borderRight: "1px solid var(--line)",
              },
              ".cm-activeLine, .cm-activeLineGutter": {
                backgroundColor: "var(--hov)",
              },
              ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
              },
              ".cm-cursor": {
                borderLeftColor: "var(--accent)",
              },
              ".cm-foldGutter span": {
                opacity: "0.65",
              },
            },
            { dark: theme === "dark" },
          ),
        ],
      });

      view = new EditorView({ state, parent: host.current });
    }

    void mount();
    return () => {
      alive = false;
      view?.destroy();
    };
  }, [onChange, tab.name, tab.path, tab.readOnly, theme]);

  return <div ref={host} className="min-h-0 flex-1" />;
}
