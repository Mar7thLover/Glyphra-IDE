import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const BRACKET_SCAN_BACKTRACK = 200_000;
const bracketPairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const closingPairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function isCodePosition(view: EditorView, position: number) {
  const name = syntaxTree(view.state).resolveInner(position, 1).name;
  return !/(comment|string|regexp)/i.test(name);
}

function bracketDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (const range of view.visibleRanges) {
    const from = Math.max(0, range.from - BRACKET_SCAN_BACKTRACK);
    const text = doc.sliceString(from, range.to);
    const stack: Array<{ char: string; depth: number }> = [];
    for (let offset = 0; offset < text.length; offset += 1) {
      const char = text[offset];
      if (!(char in bracketPairs) && !(char in closingPairs)) continue;
      const position = from + offset;
      if (!isCodePosition(view, position)) continue;

      let depth: number;
      if (char in bracketPairs) {
        depth = stack.length;
        stack.push({ char, depth });
      } else {
        const expected = closingPairs[char];
        let match = stack.length - 1;
        while (match >= 0 && stack[match]?.char !== expected) match -= 1;
        if (match < 0) {
          depth = 0;
        } else {
          depth = stack[match]?.depth ?? 0;
          stack.length = match;
        }
      }
      if (position >= range.from) {
        builder.add(
          position,
          position + 1,
          Decoration.mark({ class: `cm-bracket-depth-${depth % 6}` }),
        );
      }
    }
  }
  return builder.finish();
}

class BracketColorPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = bracketDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = bracketDecorations(update.view);
    }
  }
}

const bracketColorPlugin = ViewPlugin.fromClass(BracketColorPlugin, {
  decorations: (plugin) => plugin.decorations,
});

function indentationColumns(text: string, tabSize: number) {
  let columns = 0;
  let characters = 0;
  for (const char of text) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += tabSize - (columns % tabSize);
    else break;
    characters += 1;
  }
  return { columns, characters };
}

function indentDecorations(view: EditorView, tabSize: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const seen = new Set<number>();
  for (const range of view.visibleRanges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      const line = doc.line(number);
      const indent = indentationColumns(line.text, tabSize);
      if (indent.characters === 0) continue;
      let columns = 0;
      for (let index = 0; index < indent.characters; index += 1) {
        const char = line.text[index];
        const before = columns;
        columns += char === "\t" ? tabSize - (columns % tabSize) : 1;
        if (before % tabSize !== 0) continue;
        const position = line.from + index;
        if (seen.has(position)) continue;
        seen.add(position);
        builder.add(
          position,
          position + 1,
          Decoration.mark({ class: "cm-indent-guide" }),
        );
      }
    }
  }
  return builder.finish();
}

function indentGuidePlugin(tabSize: number) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = indentDecorations(view, tabSize);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = indentDecorations(update.view, tabSize);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const visualTheme = EditorView.baseTheme({
  ".cm-bracket-depth-0": { color: "#d97706 !important" },
  ".cm-bracket-depth-1": { color: "#7c3aed !important" },
  ".cm-bracket-depth-2": { color: "#0891b2 !important" },
  ".cm-bracket-depth-3": { color: "#db2777 !important" },
  ".cm-bracket-depth-4": { color: "#16a34a !important" },
  ".cm-bracket-depth-5": { color: "#2563eb !important" },
  ".cm-indent-guide": {
    borderLeft: "1px solid color-mix(in srgb, var(--ink-3) 24%, transparent)",
    boxSizing: "border-box",
  },
});

export interface EditorVisualOptions {
  bracketPairColorization: boolean;
  indentGuides: boolean;
  minimap: boolean;
  tabSize: number;
}

export function editorVisualExtensions(options: EditorVisualOptions): Extension {
  return [
    options.bracketPairColorization ? bracketColorPlugin : [],
    options.indentGuides ? indentGuidePlugin(options.tabSize) : [],
    options.minimap
      ? EditorView.theme({
          ".cm-scroller": { paddingRight: "76px" },
          ".cm-panels": { marginRight: "76px" },
        })
      : [],
    visualTheme,
  ];
}
