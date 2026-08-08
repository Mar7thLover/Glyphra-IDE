import { Chunk } from "@codemirror/merge";
import {
  Facet,
  RangeSetBuilder,
  type EditorState,
  StateEffect,
  StateField,
  Text,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

interface ModifiedCodeMarkerConfig {
  baseline: string;
  label: string;
}

interface ModifiedCodeMarkers {
  decorations: DecorationSet;
  gutter: ReturnType<RangeSetBuilder<ModifiedCodeGutterMarker>["finish"]>;
}

class ModifiedCodeGutterMarker extends GutterMarker {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: GutterMarker) {
    return other instanceof ModifiedCodeGutterMarker && other.label === this.label;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-modified-code-marker";
    marker.title = this.label;
    marker.setAttribute("aria-label", this.label);
    return marker;
  }
}

const modifiedCodeMarkerConfig = Facet.define<ModifiedCodeMarkerConfig, ModifiedCodeMarkerConfig>({
  combine: (configs) => configs[0] ?? { baseline: "", label: "Modified code" },
});

function normalizedText(content: string) {
  return Text.of(content.replace(/\r\n?/g, "\n").split("\n"));
}

function buildModifiedCodeMarkers(state: EditorState) {
  const config = state.facet(modifiedCodeMarkerConfig);
  const baseline = normalizedText(config.baseline);
  const gutterBuilder = new RangeSetBuilder<ModifiedCodeGutterMarker>();
  const decorationBuilder = new RangeSetBuilder<Decoration>();
  if (baseline.eq(state.doc)) {
    return { decorations: decorationBuilder.finish(), gutter: gutterBuilder.finish() };
  }
  const markedPositions = new Set<number>();

  for (const chunk of Chunk.build(baseline, state.doc, { timeout: 20 })) {
    // Deletions have no line in the current document. In that case, use the
    // nearest surviving line so the change is still visible to the user.
    const position = state.doc.lineAt(Math.min(chunk.fromB, state.doc.length)).from;
    if (markedPositions.has(position)) continue;
    markedPositions.add(position);
    gutterBuilder.add(position, position, new ModifiedCodeGutterMarker(config.label));
    decorationBuilder.add(
      position,
      position,
      Decoration.line({ class: "cm-modified-code-line" }),
    );
  }

  return { decorations: decorationBuilder.finish(), gutter: gutterBuilder.finish() };
}

const recomputeMarkers = StateEffect.define<null>();

/**
 * Diffing the whole document against the baseline is O(doc) with a 20ms diff
 * budget — far too expensive to run on every keystroke. While typing, existing
 * markers are only mapped through the changes; the plugin below schedules one
 * real recompute shortly after the burst ends.
 */
const modifiedCodeMarkers = StateField.define<ModifiedCodeMarkers>({
  create: buildModifiedCodeMarkers,
  update: (markers, transaction) => {
    if (
      transaction.reconfigured ||
      transaction.effects.some((effect) => effect.is(recomputeMarkers))
    ) {
      return buildModifiedCodeMarkers(transaction.state);
    }
    if (transaction.docChanged) {
      return {
        decorations: markers.decorations.map(transaction.changes),
        gutter: markers.gutter.map(transaction.changes),
      };
    }
    return markers;
  },
});

const MARKER_REFRESH_MS = 250;

const markerRefreshPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.view.dispatch({ effects: recomputeMarkers.of(null) });
      }, MARKER_REFRESH_MS);
    }

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

const modifiedCodeGutter = gutter({
  class: "cm-modified-code-gutter",
  markers: (view) => view.state.field(modifiedCodeMarkers).gutter,
});

const modifiedCodeMarkerTheme = EditorView.baseTheme({
  ".cm-modified-code-gutter": {
    width: "10px",
  },
  ".cm-modified-code-marker": {
    display: "block",
    width: "4px",
    height: "100%",
    minHeight: "1.55em",
    marginLeft: "3px",
    backgroundColor: "var(--accent)",
    borderRadius: "2px",
  },
  ".cm-line.cm-modified-code-line": {
    boxShadow: "inset 3px 0 0 var(--accent)",
    backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)",
  },
});

/** Marks the first line of every hunk changed since the last saved baseline. */
export function modifiedCodeMarkerExtension(
  baseline: string,
  label: string,
): Extension {
  return [
    modifiedCodeMarkerConfig.of({ baseline, label }),
    modifiedCodeMarkers,
    markerRefreshPlugin,
    EditorView.decorations.from(modifiedCodeMarkers, (markers) => markers.decorations),
    modifiedCodeGutter,
    modifiedCodeMarkerTheme,
  ];
}
