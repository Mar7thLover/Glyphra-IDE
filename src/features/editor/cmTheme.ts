import {
  HighlightStyle,
  syntaxHighlighting,
  type TagStyle,
} from "@codemirror/language";
import { Tag, tags as t } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import type { Theme, ThemeVariant } from "@/lib/stores/uiStore";
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
      ".cm-panels": {
        fontFamily: "var(--font-sans)",
        color: "var(--ink-1)",
      },
      ".cm-panels-top": {
        borderBottom: "1px solid var(--line)",
      },
      ".cm-panel.cm-search": {
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns:
          "minmax(180px, 1fr) repeat(3, max-content) repeat(3, max-content) 24px",
        alignItems: "center",
        gap: "6px",
        padding: "8px 10px",
        backgroundColor: "var(--bg-panel)",
        boxShadow: "inset 0 -1px 0 var(--glass-sheen)",
      },
      ".cm-panel.cm-search br": {
        display: "none",
      },
      ".cm-panel.cm-search .cm-textfield": {
        boxSizing: "border-box",
        height: "30px",
        minWidth: "0",
        margin: "0 !important",
        border: "1px solid var(--line)",
        borderRadius: "7px",
        padding: "0 9px",
        backgroundColor: "var(--bg-raised)",
        color: "var(--ink-1)",
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        outline: "none",
        boxShadow: "var(--shadow-soft)",
      },
      ".cm-panel.cm-search .cm-textfield:focus": {
        borderColor: "var(--line-strong)",
        boxShadow: "0 0 0 2px var(--accent-soft)",
      },
      ".cm-panel.cm-search input[name=search]": {
        gridColumn: "1",
        gridRow: "1",
      },
      ".cm-panel.cm-search input[name=replace]": {
        gridColumn: "1",
        gridRow: "2",
      },
      ".cm-panel.cm-search .cm-button": {
        boxSizing: "border-box",
        height: "28px",
        margin: "0 !important",
        border: "1px solid var(--line)",
        borderRadius: "7px",
        padding: "0 9px",
        backgroundImage: "none",
        backgroundColor: "var(--bg-raised)",
        color: "var(--ink-2)",
        fontFamily: "var(--font-sans)",
        fontSize: "11px",
        lineHeight: "26px",
        textTransform: "capitalize",
        transition: "border-color 120ms ease, background-color 120ms ease, color 120ms ease",
      },
      ".cm-panel.cm-search .cm-button:hover": {
        borderColor: "var(--line-strong)",
        backgroundColor: "var(--hov)",
        color: "var(--ink-1)",
      },
      ".cm-panel.cm-search button[name=next]": { gridColumn: "2", gridRow: "1" },
      ".cm-panel.cm-search button[name=prev]": { gridColumn: "3", gridRow: "1" },
      ".cm-panel.cm-search button[name=select]": { gridColumn: "4", gridRow: "1" },
      ".cm-panel.cm-search button[name=replace]": { gridColumn: "2", gridRow: "2" },
      ".cm-panel.cm-search button[name=replaceAll]": {
        gridColumn: "3 / span 2",
        gridRow: "2",
      },
      ".cm-panel.cm-search label": {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        height: "28px",
        margin: "0 !important",
        color: "var(--ink-3)",
        fontSize: "10px",
        whiteSpace: "nowrap",
        cursor: "pointer",
      },
      ".cm-panel.cm-search label:nth-of-type(1)": { gridColumn: "5", gridRow: "1" },
      ".cm-panel.cm-search label:nth-of-type(2)": { gridColumn: "6", gridRow: "1" },
      ".cm-panel.cm-search label:nth-of-type(3)": { gridColumn: "7", gridRow: "1" },
      ".cm-panel.cm-search input[type=checkbox]": {
        appearance: "none",
        boxSizing: "border-box",
        width: "14px",
        height: "14px",
        margin: "0 !important",
        border: "1px solid var(--line-strong)",
        borderRadius: "4px",
        backgroundColor: "var(--bg-raised)",
      },
      ".cm-panel.cm-search input[type=checkbox]:checked": {
        borderColor: "var(--accent)",
        backgroundColor: "var(--accent)",
        boxShadow: "inset 0 0 0 3px var(--bg-raised)",
      },
      ".cm-panel.cm-search button[name=close]": {
        position: "static !important",
        gridColumn: "8",
        gridRow: "1",
        width: "24px",
        height: "24px",
        margin: "0 !important",
        border: "0",
        borderRadius: "6px",
        padding: "0",
        backgroundColor: "transparent",
        color: "var(--ink-3)",
        fontFamily: "var(--font-sans)",
        fontSize: "18px",
        lineHeight: "22px",
      },
      ".cm-panel.cm-search button[name=close]:hover": {
        backgroundColor: "var(--hov)",
        color: "var(--ink-1)",
      },
      ".cm-searchMatch": {
        backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent) !important",
        outline: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)",
        borderRadius: "2px",
      },
      ".cm-searchMatch-selected": {
        backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent) !important",
        outlineColor: "color-mix(in srgb, var(--accent) 55%, transparent)",
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

/**
 * Syntax highlighting for the Contrast tone.
 *
 * The regular palettes are chromatic, and hue is exactly what stops carrying
 * meaning when the surface is pure black or pure white. This one differentiates
 * with weight, slant and a few gray steps instead, every one of which clears
 * WCAG AAA (7:1) against `#fff` and `#000`.
 */
function contrastHighlight(dark: boolean) {
  const strong = dark ? "#ffffff" : "#000000";
  const body = dark ? "#d4d4d4" : "#333333";
  const muted = dark ? "#b0b0b0" : "#4a4a4a";
  return HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.self], color: strong, fontWeight: "700" },
    { tag: [t.atom, t.bool, t.null], color: strong, fontWeight: "700" },
    {
      tag: [t.typeName, t.className, t.namespace, t.annotation],
      color: strong,
      fontWeight: "600",
    },
    { tag: [t.function(t.variableName), t.labelName, t.macroName], color: strong },
    { tag: [t.definition(t.name), t.propertyName], color: strong },
    { tag: [t.string, t.special(t.string), t.inserted, t.processingInstruction], color: body },
    { tag: [t.number, t.constant(t.name), t.regexp, t.escape], color: body },
    { tag: [t.variableName, t.operator, t.punctuation, t.separator], color: body },
    { tag: [t.comment, t.meta, t.lineComment, t.blockComment, t.docComment], color: muted, fontStyle: "italic" },
    { tag: t.link, color: body, textDecoration: "underline" },
    { tag: t.heading, color: strong, fontWeight: "700" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.invalid, color: "var(--danger)", fontWeight: "700" },
  ]);
}

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
  variant: ThemeVariant = "neutral",
): Extension[] {
  const dark = theme === "dark";
  const imported = importedTheme ? importedHighlightStyle(importedTheme) : null;
  // An imported VS Code theme is an explicit choice of palette, so it still
  // wins — the tone only governs Glyphra's own highlighting.
  const base =
    variant === "contrast"
      ? contrastHighlight(dark)
      : dark
        ? darkHighlight
        : lightHighlight;
  return [
    chromeTheme(dark),
    syntaxHighlighting(base),
    imported ? syntaxHighlighting(imported) : [],
  ];
}
