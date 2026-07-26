import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";

export interface GhostSuggestion {
  /** Document offset the suggestion is anchored to (the cursor at request time). */
  from: number;
  text: string;
}

export const setGhostSuggestion = StateEffect.define<GhostSuggestion | null>();

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostTextWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-glyphra-ghost";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * The pending suggestion. Any edit or cursor move invalidates it — accepting
 * stale ghost text is worse than showing none, so the field is deliberately
 * eager about clearing itself.
 */
export const ghostSuggestionField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGhostSuggestion)) return effect.value;
    }
    if (!value) return null;
    if (transaction.docChanged || transaction.selection) return null;
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      if (!value?.text) return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new GhostTextWidget(value.text),
          side: 1,
        }).range(value.from),
      ]);
    }),
});

export function currentGhostSuggestion(view: EditorView): GhostSuggestion | null {
  return view.state.field(ghostSuggestionField, false) ?? null;
}

export function clearGhostSuggestion(view: EditorView) {
  if (!currentGhostSuggestion(view)) return false;
  view.dispatch({ effects: setGhostSuggestion.of(null) });
  return true;
}

export function acceptGhostSuggestion(view: EditorView) {
  const suggestion = currentGhostSuggestion(view);
  if (!suggestion?.text) return false;
  const cursor = view.state.selection.main;
  if (!cursor.empty || cursor.head !== suggestion.from) {
    view.dispatch({ effects: setGhostSuggestion.of(null) });
    return false;
  }
  view.dispatch({
    changes: { from: suggestion.from, insert: suggestion.text },
    selection: { anchor: suggestion.from + suggestion.text.length },
    effects: setGhostSuggestion.of(null),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  return true;
}

export interface GhostTextConfig {
  /** Read live so a settings toggle takes effect without remounting the editor. */
  enabled: () => boolean;
  delayMs: () => number;
  /**
   * Produce the text to insert at `pos`, or null when there is nothing to
   * suggest. Rejections are swallowed: inline completion is best-effort.
   */
  request: (view: EditorView, pos: number) => Promise<string | null>;
  /** Called when a request is abandoned so callers can cancel their transport. */
  onAbandon?: () => void;
}

const ghostTheme = EditorView.theme({
  ".cm-glyphra-ghost": {
    color: "var(--ink-3)",
    opacity: "0.65",
    fontStyle: "italic",
    whiteSpace: "pre",
    pointerEvents: "none",
  },
});

/**
 * Debounced inline completion.
 *
 * Requests only fire after typing pauses, only for a collapsed cursor, and
 * never while an IME composition is active (see docs/ime-checklist.md). A
 * result that arrives after the document or cursor moved is discarded.
 */
export function ghostTextExtension(config: GhostTextConfig): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private generation = 0;
      private pending = false;

      constructor(readonly view: EditorView) {}

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        this.abandon();
        if (!update.docChanged) return;
        if (update.view.composing) return;
        if (!config.enabled()) return;
        if (update.state.readOnly) return;
        const delay = Math.max(120, config.delayMs());
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.request();
        }, delay);
      }

      /** Invalidate the scheduled and in-flight request for this view. */
      private abandon() {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.generation += 1;
        if (this.pending) {
          this.pending = false;
          config.onAbandon?.();
        }
      }

      private async request() {
        const view = this.view;
        const cursor = view.state.selection.main;
        if (!cursor.empty || view.composing) return;
        const pos = cursor.head;
        const docLength = view.state.doc.length;
        const ticket = ++this.generation;
        this.pending = true;
        let text: string | null = null;
        try {
          text = await config.request(view, pos);
        } catch {
          // Best-effort: a failed completion must never interrupt typing.
        }
        if (ticket !== this.generation) return;
        this.pending = false;
        if (!text) return;
        const now = view.state.selection.main;
        if (
          view.state.doc.length !== docLength ||
          !now.empty ||
          now.head !== pos ||
          view.composing
        ) {
          return;
        }
        view.dispatch({ effects: setGhostSuggestion.of({ from: pos, text }) });
      }

      destroy() {
        this.abandon();
      }
    },
  );

  return [
    ghostSuggestionField,
    ghostTheme,
    plugin,
    // Above autocompletion's Tab/Escape handlers; both fall through when no
    // suggestion is showing, so ordinary indent and popup-close still work.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptGhostSuggestion },
        { key: "Escape", run: clearGhostSuggestion },
      ]),
    ),
    EditorView.domEventHandlers({
      blur: (_event, view) => {
        clearGhostSuggestion(view);
        return false;
      },
    }),
  ];
}
