import { describe, expect, it } from "vitest";

import {
  codeMirrorKey,
  commandMatches,
  evaluateWhen,
  shortcutFromEvent,
} from "./keybindings";

function keyEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    key: "k",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 75,
    defaultPrevented: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("keybinding when clauses", () => {
  it("supports negation, conjunction, and alternatives", () => {
    expect(evaluateWhen("editorFocus && projectOpen", {
      editorFocus: true,
      projectOpen: true,
    })).toBe(true);
    expect(evaluateWhen("editorFocus && !settingsOpen", {
      editorFocus: true,
      settingsOpen: true,
    })).toBe(false);
    expect(evaluateWhen("agentBusy || projectOpen", { projectOpen: true })).toBe(true);
    expect(evaluateWhen("unknown", {})).toBe(false);
  });
});

describe("shortcut capture", () => {
  it("maps Control and Command to the portable Ctrl token", () => {
    expect(
      shortcutFromEvent({
        key: "p",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe("Ctrl+Shift+P");
  });

  it("ignores modifier-only input", () => {
    expect(
      shortcutFromEvent({
        key: "Control",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });
});

describe("commandMatches", () => {
  it("matches a default workbench binding", () => {
    expect(commandMatches(keyEvent(), "workbench.commands")).toBe(true);
  });

  it("yields to a key the editor already handled", () => {
    expect(
      commandMatches(keyEvent({ defaultPrevented: true }), "workbench.commands"),
    ).toBe(false);
  });

  it("honours the when clause of the inline-edit binding", () => {
    expect(commandMatches(keyEvent(), "editor.inlineEdit", { editorFocus: true })).toBe(
      true,
    );
    expect(commandMatches(keyEvent(), "editor.inlineEdit", { editorFocus: false })).toBe(
      false,
    );
  });
});

describe("codeMirrorKey", () => {
  it("translates modifiers and letter keys", () => {
    expect(codeMirrorKey("Ctrl+K")).toBe("Mod-k");
    expect(codeMirrorKey("Ctrl+Shift+K")).toBe("Mod-Shift-k");
    expect(codeMirrorKey("Alt+Enter")).toBe("Alt-Enter");
  });

  it("uses CodeMirror names for arrows and escape", () => {
    expect(codeMirrorKey("Ctrl+Up")).toBe("Mod-ArrowUp");
    expect(codeMirrorKey("Escape")).toBe("Escape");
  });
});
