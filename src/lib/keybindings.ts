import { usePrefsStore } from "@/lib/stores/prefsStore";

export interface KeybindingContext {
  editorFocus?: boolean;
  projectOpen?: boolean;
  settingsOpen?: boolean;
  agentBusy?: boolean;
}

function contextValue(context: KeybindingContext, name: string): boolean {
  return Boolean(context[name as keyof KeybindingContext]);
}

/** Supports the intentionally small `name`, `!name`, `&&`, `||` when-clause grammar. */
export function evaluateWhen(expression: string | null, context: KeybindingContext): boolean {
  if (!expression?.trim()) return true;
  return expression.split("||").some((branch) =>
    branch.split("&&").every((rawTerm) => {
      const term = rawTerm.trim();
      if (!term) return false;
      if (term === "true") return true;
      if (term === "false") return false;
      return term.startsWith("!")
        ? !contextValue(context, term.slice(1).trim())
        : contextValue(context, term);
    }),
  );
}

function normalizedKey(key: string): string {
  if (key === " ") return "Space";
  if (key === ",") return ",";
  if (key === "`") return "`";
  if (key.length === 1) return key.toUpperCase();
  const names: Record<string, string> = {
    Esc: "Escape",
    Control: "Ctrl",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return names[key] ?? `${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`;
}

export function shortcutFromEvent(event: Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>): string | null {
  const key = normalizedKey(event.key);
  if (["Ctrl", "Shift", "Alt", "Meta"].includes(key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop() ?? "";
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  return [
    modifiers.has("ctrl") || modifiers.has("cmd") || modifiers.has("meta") ? "Ctrl" : null,
    modifiers.has("shift") ? "Shift" : null,
    modifiers.has("alt") || modifiers.has("option") ? "Alt" : null,
    normalizedKey(key),
  ]
    .filter(Boolean)
    .join("+");
}

/** Glyphra shortcut names that CodeMirror spells differently. */
const CODEMIRROR_KEY_NAMES: Record<string, string> = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Esc: "Escape",
  Space: " ",
};

/**
 * Translate a stored shortcut ("Ctrl+Shift+K") into a CodeMirror key spec
 * ("Mod-Shift-k") so an editor-scoped binding can be driven by user settings.
 * Returns null for shortcuts CodeMirror cannot express as a single stroke.
 */
export function codeMirrorKey(shortcut: string): string | null {
  const normalized = normalizeShortcut(shortcut);
  const parts = normalized.split("+").filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const modifiers = parts.map((part) => (part === "Ctrl" ? "Mod" : part));
  const name =
    CODEMIRROR_KEY_NAMES[key] ?? (key.length === 1 ? key.toLowerCase() : key);
  return [...modifiers, name].join("-");
}

export function commandMatches(
  event: KeyboardEvent,
  command: string,
  context: KeybindingContext = {},
): boolean {
  if (event.repeat || event.isComposing || event.keyCode === 229) return false;
  // CodeMirror calls preventDefault for keys it handled. Window-level bindings
  // run afterwards on the bubble, so this is what lets an editor binding such as
  // Ctrl+K inline edit take a shortcut the workbench also claims.
  if (event.defaultPrevented) return false;
  const pressed = shortcutFromEvent(event);
  if (!pressed) return false;
  return usePrefsStore
    .getState()
    .keybindings.some(
      (binding) =>
        binding.command === command &&
        normalizeShortcut(binding.key) === pressed &&
        evaluateWhen(binding.when, context),
    );
}
