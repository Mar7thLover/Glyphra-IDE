import { describe, expect, it } from "vitest";

import { cssVariablesForTheme } from "./vscodeTheme";

describe("VS Code theme mapping", () => {
  it("maps safe workbench colors into Glyphra runtime tokens", () => {
    const variables = cssVariablesForTheme({
      name: "Fixture",
      base: "dark",
      sourcePath: "/fixture/theme.json",
      colors: [
        { key: "editor.background", value: "#101010" },
        { key: "editor.foreground", value: "#eeeeee" },
        { key: "focusBorder", value: "#00aaff" },
      ],
      tokenColors: [],
    });
    expect(variables).toMatchObject({
      "--bg-editor": "#101010",
      "--ink-1": "#eeeeee",
      "--accent": "#00aaff",
      "--line-strong": "#00aaff",
    });
  });
});
