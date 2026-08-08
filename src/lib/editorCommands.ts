export const EDITOR_COMMAND_EVENT = "glyphra:editor-command";
export const EDITOR_FLUSH_EVENT = "glyphra:editor-flush";

/**
 * Mounted editors debounce their store sync (~140ms) to keep typing off the
 * global render path. Anything that is about to read buffer contents from the
 * store (save, recovery snapshot, close/exit flows) must call this first: the
 * event is handled synchronously, so pending keystrokes land in the store
 * before the caller's next line runs.
 */
export function flushPendingEditorChanges() {
  // Store logic runs under vitest's node environment where no window exists.
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EDITOR_FLUSH_EVENT));
}

export type EditorCommand =
  | "undo"
  | "redo"
  | "selectAll"
  | "goToDefinition"
  | "findReferences"
  | "rename";

export function dispatchEditorCommand(command: EditorCommand) {
  window.dispatchEvent(new CustomEvent<EditorCommand>(EDITOR_COMMAND_EVENT, { detail: command }));
}
