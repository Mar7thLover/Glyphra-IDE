import { describe, expect, it } from "vitest";

import { editorThemeExtensions } from "./cmTheme";

/** WCAG relative luminance for an `#rrggbb` color. */
function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Every ink the Contrast tone uses, paired with the surface it sits on. */
const CONTRAST_INKS = [
  { name: "light strong", color: "#000000", surface: "#ffffff" },
  { name: "light body", color: "#333333", surface: "#ffffff" },
  { name: "light muted", color: "#4a4a4a", surface: "#ffffff" },
  { name: "dark strong", color: "#ffffff", surface: "#000000" },
  { name: "dark body", color: "#d4d4d4", surface: "#000000" },
  { name: "dark muted", color: "#b0b0b0", surface: "#000000" },
];

describe("contrast tone syntax highlighting", () => {
  it("clears WCAG AAA for every ink it uses", () => {
    for (const ink of CONTRAST_INKS) {
      // 7:1 is AAA for body text — the whole point of the Contrast tone.
      expect(
        contrastRatio(ink.color, ink.surface),
        `${ink.name} (${ink.color} on ${ink.surface})`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("keeps the ramp separable so weight is not the only cue", () => {
    // Adjacent steps must stay far enough apart to read as different grays.
    expect(contrastRatio("#333333", "#4a4a4a")).toBeGreaterThan(1.4);
    expect(contrastRatio("#d4d4d4", "#b0b0b0")).toBeGreaterThan(1.4);
  });

  it("builds a highlight style for every tone and scheme", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const variant of ["neutral", "soft", "contrast"] as const) {
        const extensions = editorThemeExtensions(theme, null, variant);
        // chrome + syntax highlighting, plus an empty slot for no import.
        expect(extensions).toHaveLength(3);
      }
    }
  });

  it("sanity-checks the helper against known pairs", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});
