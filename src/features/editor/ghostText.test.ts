import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  acceptGhostSuggestion,
  clearGhostSuggestion,
  ghostSuggestionField,
  setGhostSuggestion,
} from "./ghostText";

function stateWith(doc: string, cursor = doc.length) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [ghostSuggestionField],
  });
}

/**
 * Minimal stand-in for EditorView: the ghost-text commands only read `state`
 * and call `dispatch`, and the test environment has no DOM.
 */
function fakeView(state: EditorState) {
  const view = {
    state,
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view as unknown as EditorView & { state: EditorState };
}

describe("ghostSuggestionField", () => {
  it("stores a suggestion set through the effect", () => {
    const state = stateWith("const a = ");
    const next = state.update({
      effects: setGhostSuggestion.of({ from: 10, text: "1;" }),
    }).state;
    expect(next.field(ghostSuggestionField)).toEqual({ from: 10, text: "1;" });
  });

  it("clears on any document change", () => {
    const state = stateWith("const a = ").update({
      effects: setGhostSuggestion.of({ from: 10, text: "1;" }),
    }).state;
    const typed = state.update({ changes: { from: 10, insert: "2" } }).state;
    expect(typed.field(ghostSuggestionField)).toBeNull();
  });

  it("clears on any cursor move", () => {
    const state = stateWith("const a = ").update({
      effects: setGhostSuggestion.of({ from: 10, text: "1;" }),
    }).state;
    const moved = state.update({ selection: { anchor: 3 } }).state;
    expect(moved.field(ghostSuggestionField)).toBeNull();
  });
});

describe("acceptGhostSuggestion", () => {
  it("inserts the suggestion and places the cursor after it", () => {
    const view = fakeView(
      stateWith("const a = ").update({
        effects: setGhostSuggestion.of({ from: 10, text: "1;" }),
      }).state,
    );
    expect(acceptGhostSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("const a = 1;");
    expect(view.state.selection.main.head).toBe(12);
    expect(view.state.field(ghostSuggestionField)).toBeNull();
  });

  it("falls through to the default Tab handler with no suggestion", () => {
    const view = fakeView(stateWith("const a = "));
    expect(acceptGhostSuggestion(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("const a = ");
  });

  it("refuses a suggestion anchored away from the cursor", () => {
    const base = stateWith("const a = ", 4).update({
      effects: setGhostSuggestion.of({ from: 10, text: "1;" }),
    }).state;
    // The field clears on selection changes, so reconstruct the stale pairing
    // the way a race between an async result and a click would produce it.
    const view = fakeView(base);
    expect(acceptGhostSuggestion(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("const a = ");
    expect(view.state.field(ghostSuggestionField)).toBeNull();
  });
});

describe("clearGhostSuggestion", () => {
  it("reports whether it consumed the key", () => {
    const empty = fakeView(stateWith("x"));
    expect(clearGhostSuggestion(empty)).toBe(false);

    const showing = fakeView(
      stateWith("x").update({ effects: setGhostSuggestion.of({ from: 1, text: "y" }) })
        .state,
    );
    expect(clearGhostSuggestion(showing)).toBe(true);
    expect(showing.state.field(ghostSuggestionField)).toBeNull();
  });
});
