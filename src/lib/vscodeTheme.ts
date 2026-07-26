import type { ImportedTheme } from "@/lib/ipc/ipc";

const workbenchMappings: Array<[string, string[]]> = [
  ["--bg-app", ["activityBar.background", "titleBar.activeBackground", "sideBar.background"]],
  ["--bg-editor", ["editor.background"]],
  ["--bg-panel", ["sideBar.background", "panel.background"]],
  ["--bg-raised", ["input.background", "dropdown.background", "button.secondaryBackground"]],
  ["--bg-overlay", ["editorWidget.background", "menu.background", "quickInput.background"]],
  ["--ink-1", ["editor.foreground", "foreground"]],
  ["--ink-2", ["sideBar.foreground", "descriptionForeground"]],
  ["--ink-3", ["editorLineNumber.foreground", "disabledForeground"]],
  ["--line", ["editorGroup.border", "panel.border", "widget.border"]],
  ["--line-strong", ["focusBorder", "contrastBorder"]],
  ["--accent", ["focusBorder", "button.background", "textLink.foreground"]],
  ["--accent-hover", ["button.hoverBackground", "textLink.activeForeground"]],
  ["--accent-ink", ["button.foreground"]],
  ["--accent-soft", ["editor.selectionBackground", "list.inactiveSelectionBackground"]],
  ["--hov", ["list.hoverBackground", "toolbar.hoverBackground"]],
  ["--act", ["list.activeSelectionBackground", "editor.selectionBackground"]],
  ["--danger", ["errorForeground", "editorError.foreground"]],
  ["--ok", ["gitDecoration.addedResourceForeground", "testing.iconPassed"]],
];

export const importedThemeCssProperties = workbenchMappings.map(([property]) => property);

export function cssVariablesForTheme(theme: ImportedTheme) {
  const colors = new Map(theme.colors.map((entry) => [entry.key, entry.value]));
  const variables: Record<string, string> = {};
  for (const [property, candidates] of workbenchMappings) {
    const value = candidates.map((candidate) => colors.get(candidate)).find(Boolean);
    if (value) variables[property] = value;
  }
  return variables;
}

export function applyImportedTheme(theme: ImportedTheme | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const property of importedThemeCssProperties) {
    root.style.removeProperty(property);
  }
  if (!theme) {
    delete root.dataset.customTheme;
    return;
  }
  root.dataset.customTheme = theme.name;
  for (const [property, value] of Object.entries(cssVariablesForTheme(theme))) {
    root.style.setProperty(property, value);
  }
}
