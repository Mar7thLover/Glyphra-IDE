import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import type { Theme } from "@/lib/stores/uiStore";

const chromeTheme = (dark: boolean) =>
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
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--accent)",
      },
      ".cm-foldGutter span": {
        opacity: "0.65",
      },
    },
    { dark },
  );

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#7c3aed" },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "#0f766e" },
  { tag: [t.function(t.variableName), t.labelName], color: "#1d4ed8" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#b45309" },
  { tag: [t.definition(t.name), t.separator], color: "#334155" },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#c2410c" },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: "#0e7490" },
  { tag: [t.meta, t.comment], color: "#64748b", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "#2563eb", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "#1e293b" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#7c3aed" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#15803d" },
  { tag: t.invalid, color: "#dc2626" },
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c4b5fd" },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "#5eead4" },
  { tag: [t.function(t.variableName), t.labelName], color: "#93c5fd" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#fbbf24" },
  { tag: [t.definition(t.name), t.separator], color: "#e2e8f0" },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#fdba74" },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: "#67e8f9" },
  { tag: [t.meta, t.comment], color: "#94a3b8", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "#93c5fd", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "#f8fafc" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#c4b5fd" },
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#86efac" },
  { tag: t.invalid, color: "#f87171" },
]);

export function editorThemeExtensions(theme: Theme): Extension[] {
  const dark = theme === "dark";
  return [chromeTheme(dark), syntaxHighlighting(dark ? darkHighlight : lightHighlight)];
}
