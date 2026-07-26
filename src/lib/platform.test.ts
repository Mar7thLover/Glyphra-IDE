import { describe, expect, it } from "vitest";

import { formatShortcut } from "./platform";

describe("formatShortcut", () => {
  it("uses macOS-native modifier glyphs", () => {
    expect(formatShortcut("Ctrl+P", "macos")).toBe("⌘P");
    expect(formatShortcut("Ctrl+Shift+R", "macos")).toBe("⌘⇧R");
    expect(formatShortcut("Alt+F4", "macos")).toBe("⌘Q");
  });

  it("leaves Windows and Linux labels unchanged", () => {
    expect(formatShortcut("Ctrl+K", "windows")).toBe("Ctrl+K");
    expect(formatShortcut("Ctrl+K", "linux")).toBe("Ctrl+K");
  });
});
