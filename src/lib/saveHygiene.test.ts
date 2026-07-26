import { describe, expect, it } from "vitest";

import { prepareContentForSave } from "./saveHygiene";

const defaults = {
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  formatOnSave: false,
  tabSize: 2,
};

describe("prepareContentForSave", () => {
  it("trims trailing whitespace and adds a final newline", () => {
    expect(prepareContentForSave("a.ts", "const x = 1;  \nnext\t", defaults)).toBe(
      "const x = 1;\nnext\n",
    );
  });

  it("preserves CRLF", () => {
    expect(prepareContentForSave("a.ts", "one  \r\ntwo", defaults)).toBe(
      "one\r\ntwo\r\n",
    );
  });

  it("optionally formats valid JSON but leaves invalid JSON untouched", () => {
    expect(
      prepareContentForSave("package.json", '{"a":1}', {
        ...defaults,
        formatOnSave: true,
      }),
    ).toBe('{\n  "a": 1\n}\n');
    expect(
      prepareContentForSave("package.json", "{bad", {
        ...defaults,
        formatOnSave: true,
      }),
    ).toBe("{bad\n");
  });

  it("applies EditorConfig line endings and final-newline removal", () => {
    expect(
      prepareContentForSave("a.txt", "one\n\ntwo\n", {
        ...defaults,
        insertFinalNewline: false,
        removeFinalNewline: true,
        endOfLine: "crlf",
      }),
    ).toBe("one\r\n\r\ntwo");
  });
});
