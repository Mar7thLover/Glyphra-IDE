import {
  acceptChunk,
  getChunks,
  goToNextChunk,
  goToPreviousChunk,
  rejectChunk,
  unifiedMergeView,
} from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { editorThemeExtensions } from "@/features/editor/cmTheme";
import { useUiStore } from "@/lib/stores/uiStore";

export interface MergeEditorHandle {
  decide: (decision: "accept" | "reject") => boolean;
  focusFirstHunk: () => void;
  moveHunk: (direction: 1 | -1) => boolean;
}

interface MergeEditorProps {
  before: string;
  after: string;
  readOnly?: boolean;
  acceptLabel: string;
  rejectLabel: string;
  onMerged?: (content: string) => void;
  onHunkProgress?: (remaining: number, total: number) => void;
  onResolved?: () => void;
}

const MergeEditor = forwardRef<MergeEditorHandle, MergeEditorProps>(function MergeEditor(
  {
    before,
    after,
    readOnly = false,
    acceptLabel,
    rejectLabel,
    onMerged,
    onHunkProgress,
    onResolved,
  },
  ref,
) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const totalHunks = useRef(0);
  const remainingHunks = useRef(0);
  const callbacks = useRef({ onMerged, onHunkProgress, onResolved });
  callbacks.current = { onMerged, onHunkProgress, onResolved };
  const theme = useUiStore((s) => s.theme);
  const themeVariant = useUiStore((s) => s.variant);

  useImperativeHandle(ref, () => ({
    decide: (decision) => {
      const view = viewRef.current;
      if (!view || readOnly) return false;
      const chunks = getChunks(view.state)?.chunks ?? [];
      if (chunks.length === 0) return false;
      const head = view.state.selection.main.head;
      if (!chunks.some((chunk) => chunk.fromB <= head && chunk.endB >= head)) {
        goToNextChunk(view);
      }
      const changed = decision === "accept" ? acceptChunk(view) : rejectChunk(view);
      if (changed && (getChunks(view.state)?.chunks.length ?? 0) > 0) {
        goToNextChunk(view);
      }
      return changed;
    },
    focusFirstHunk: () => {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      goToNextChunk(view);
    },
    moveHunk: (direction) => {
      const view = viewRef.current;
      if (!view) return false;
      return direction === 1 ? goToNextChunk(view) : goToPreviousChunk(view);
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const renderControl = (type: "accept" | "reject", action: (event: MouseEvent) => void) => {
      const button = document.createElement("button");
      button.type = "button";
      button.name = type;
      button.textContent = type === "accept" ? acceptLabel : rejectLabel;
      button.className = `glyphra-merge-control glyphra-merge-control-${type}`;
      button.onmousedown = action;
      return button;
    };
    const state = EditorState.create({
      doc: after,
      extensions: [
        basicSetup,
        unifiedMergeView({
          original: before,
          mergeControls: readOnly ? false : renderControl,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 8 },
        }),
        ...(readOnly ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : []),
        ...editorThemeExtensions(theme, null, themeVariant),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onMerged?.(update.state.doc.toString());
          const remaining = getChunks(update.state)?.chunks.length ?? 0;
          if (remaining !== remainingHunks.current) {
            const previous = remainingHunks.current;
            remainingHunks.current = remaining;
            callbacks.current.onHunkProgress?.(remaining, totalHunks.current);
            if (previous > 0 && remaining === 0) callbacks.current.onResolved?.();
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", paddingBottom: "24px" },
          ".cm-changedLine": { paddingTop: "2px", paddingBottom: "2px" },
          ".cm-deletedChunk": { marginTop: "8px", marginBottom: "8px" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    totalHunks.current = getChunks(view.state)?.chunks.length ?? 0;
    remainingHunks.current = totalHunks.current;
    callbacks.current.onHunkProgress?.(remainingHunks.current, totalHunks.current);
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [acceptLabel, after, before, readOnly, rejectLabel, theme, themeVariant]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
});

export default MergeEditor;
