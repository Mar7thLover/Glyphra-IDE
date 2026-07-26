import { describe, expect, it } from "vitest";

import { reviewKeyboardAction } from "./reviewKeyboard";

const base = {
  shiftKey: false,
  hasModifier: false,
  isEditor: false,
  keyboardMode: false,
  hasContents: true,
  hasReviewFile: true,
};

describe("review keyboard flow", () => {
  it("navigates files and enters/exits hunk keyboard mode", () => {
    expect(reviewKeyboardAction({ ...base, key: "j" })).toBe("next-file");
    expect(reviewKeyboardAction({ ...base, key: "k" })).toBe("previous-file");
    expect(reviewKeyboardAction({ ...base, key: "Enter" })).toBe("focus-hunk");
    expect(
      reviewKeyboardAction({ ...base, key: "Escape", keyboardMode: true }),
    ).toBe("exit-keyboard");
  });

  it("distinguishes hunk and whole-file decisions", () => {
    expect(reviewKeyboardAction({ ...base, key: "a" })).toBe("accept-hunk");
    expect(reviewKeyboardAction({ ...base, key: "r" })).toBe("reject-hunk");
    expect(reviewKeyboardAction({ ...base, key: "A", shiftKey: true })).toBe(
      "accept-file",
    );
  });

  it("does not steal editor input or modified shortcuts", () => {
    expect(reviewKeyboardAction({ ...base, key: "a", isEditor: true })).toBe(
      "none",
    );
    expect(reviewKeyboardAction({ ...base, key: "j", hasModifier: true })).toBe(
      "none",
    );
  });
});
