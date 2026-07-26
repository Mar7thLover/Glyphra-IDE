export function formatShortcut(shortcut: string, hostOs: string): string {
  if (hostOs !== "macos") return shortcut;
  if (shortcut === "Alt+F4") return "⌘Q";
  return shortcut
    .replace(/^Ctrl\+Shift\+/, "⌘⇧")
    .replace(/^Ctrl\+/, "⌘")
    .replace(/^Alt\+/, "⌥");
}
