import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { editorThemeExtensions } from "@/features/editor/cmTheme";
import { useUiStore } from "@/lib/stores/uiStore";

interface MergeEditorProps {
  before: string;
  after: string;
  onMerged: (content: string) => void;
}

/**
 * unifiedMergeView host — Accept/Reject chunk buttons are built into CM merge.
 * Rejected hunks restore original; accepted keep modified. We persist on change.
 */
export default function MergeEditor({ before, after, onMerged }: MergeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const theme = useUiStore((s) => s.theme);
  const onMergedRef = useRef(onMerged);
  onMergedRef.current = onMerged;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: after,
      extensions: [
        basicSetup,
        unifiedMergeView({
          original: before,
          mergeControls: true,
          gutter: true,
        }),
        ...editorThemeExtensions(theme),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onMergedRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "var(--font-mono)" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    return () => {
      view.destroy();
    };
  }, [before, after, theme]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
