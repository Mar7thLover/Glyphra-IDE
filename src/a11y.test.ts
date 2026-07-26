import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source-level accessibility guards.
 *
 * These are deliberately static: they run in the same fast, DOM-free suite as
 * everything else and catch the regressions that a manual pass keeps finding —
 * an icon-only button with no name, a click handler only a mouse can reach.
 * They do not replace a screen-reader walkthrough of the running app.
 */

const SOURCE_ROOT = join(process.cwd(), "src");

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

function locate(source: string, index: number, file: string) {
  return `${file.slice(SOURCE_ROOT.length + 1)}:${source.slice(0, index).split("\n").length}`;
}

const files = tsxFiles(SOURCE_ROOT).map((file) => ({
  file,
  source: readFileSync(file, "utf8"),
}));

describe("accessibility guards", () => {
  it("finds components to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("gives every button an accessible name", () => {
    const offenders: string[] = [];
    for (const { file, source } of files) {
      for (const match of source.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)) {
        const [, attributes, body] = match;
        if (/aria-label|aria-labelledby|title=/.test(attributes)) continue;
        // Strip nested elements and JSX expressions; anything left is literal
        // text. `t(` and `children` cover translated and forwarded labels.
        const literal = body.replace(/<[^>]*>/g, "").replace(/\{[^{}]*\}/g, "").trim();
        if (literal.length > 0 || /\bt\(|children|label/.test(body)) continue;
        offenders.push(locate(source, match.index ?? 0, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps click handlers off elements the keyboard cannot reach", () => {
    const offenders: string[] = [];
    for (const { file, source } of files) {
      for (const match of source.matchAll(/<(div|span|li)\b([^>]*?)>/g)) {
        const attributes = match[2];
        if (!/onClick=/.test(attributes)) continue;
        if (/role=|tabIndex=/.test(attributes)) continue;
        offenders.push(locate(source, match.index ?? 0, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("marks every modal overlay as a dialog", () => {
    const offenders: string[] = [];
    for (const { file, source } of files) {
      // A full-bleed blurred backdrop is Glyphra's modal idiom; each one must
      // expose dialog semantics so focus and screen readers are scoped to it.
      if (!/inset-0[^"]*backdrop-blur/.test(source)) continue;
      if (/role="(dialog|alertdialog)"/.test(source)) continue;
      offenders.push(file.slice(SOURCE_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});
