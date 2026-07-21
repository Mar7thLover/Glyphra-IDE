export const EDITOR_COMMAND_EVENT = "glyphra:editor-command";

export type EditorCommand = "undo" | "redo" | "selectAll";

export function dispatchEditorCommand(command: EditorCommand) {
  window.dispatchEvent(new CustomEvent<EditorCommand>(EDITOR_COMMAND_EVENT, { detail: command }));
}
