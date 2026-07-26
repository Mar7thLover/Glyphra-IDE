import {
  HighlightStyle,
  syntaxHighlighting,
  type TagStyle,
} from "@codemirror/language";
import { Tag, tags as t } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import type { Theme } from "@/lib/stores/uiStore";
import type { ImportedTheme } from "@/lib/ipc/ipc";

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

function scopeTags(scope: string): Tag[] {
  const value = scope.toLowerCase();
  if (value.includes("invalid")) return [t.invalid];
  if (value.includes("comment")) return [t.comment];
  if (value.includes("regexp")) return [t.regexp];
  if (value.includes("string")) return [t.string];
  if (value.includes("keyword") || value.includes("storage")) return [t.keyword];
  if (value.includes("entity.name.function") || value.includes("support.function")) {
    return [t.function(t.variableName)];
  }
  if (
    value.includes("entity.name.type") ||
    value.includes("entity.name.class") ||
    value.includes("support.type") ||
    value.includes("support.class")
  ) {
    return [t.typeName, t.className];
  }
  if (value.includes("entity.name.tag")) return [t.tagName];
  if (value.includes("attribute")) return [t.attributeName];
  if (value.includes("constant.numeric")) return [t.number];
  if (value.includes("constant.language")) return [t.bool, t.atom];
  if (value.includes("constant")) return [t.constant(t.name)];
  if (value.includes("variable") || value.includes("parameter")) return [t.variableName];
  if (value.includes("operator")) return [t.operator];
  if (value.includes("punctuation")) return [t.punctuation];
  if (value.includes("entity.name")) return [t.definition(t.name)];
  return [];
}

function importedHighlightStyle(theme: ImportedTheme) {
  const styles = theme.tokenColors.flatMap<TagStyle>((rule) => {
    const tags = [...new Set(rule.scopes.flatMap(scopeTags))];
    if (tags.length === 0) return [];
    const style: TagStyle = { tag: tags };
    if (rule.foreground) style.color = rule.foreground;
    if (rule.background) style.backgroundColor = rule.background;
    const fontStyles = new Set((rule.fontStyle ?? "").toLowerCase().split(/\s+/));
    if (fontStyles.has("bold")) style.fontWeight = "bold";
    if (fontStyles.has("italic")) style.fontStyle = "italic";
    const decorations = [
      fontStyles.has("underline") ? "underline" : "",
      fontStyles.has("strikethrough") ? "line-through" : "",
    ].filter(Boolean);
    if (decorations.length > 0) style.textDecoration = decorations.join(" ");
    return [style];
  });
  return styles.length > 0 ? HighlightStyle.define(styles) : null;
}

export function editorThemeExtensions(
  theme: Theme,
  importedTheme: ImportedTheme | null = null,
): Extension[] {
  const dark = theme === "dark";
  const imported = importedTheme ? importedHighlightStyle(importedTheme) : null;
  return [
    chromeTheme(dark),
    syntaxHighlighting(dark ? darkHighlight : lightHighlight),
    imported ? syntaxHighlighting(imported) : [],
  ];
}
