import { describe, expect, it } from "vitest";

import { buildCrashReport } from "./crashReport";

describe("buildCrashReport", () => {
  it("includes actionable error and runtime diagnostics", () => {
    const error = new TypeError("render exploded");
    error.stack = "TypeError: render exploded\n  at Widget";

    const report = buildCrashReport(error, "\n  at Widget", {
      timestamp: "2026-07-24T00:00:00.000Z",
      userAgent: "GlyphraTest/1.0",
    });

    expect(report).toContain("[Glyphra UI crash]");
    expect(report).toContain("time: 2026-07-24T00:00:00.000Z");
    expect(report).toContain("ua: GlyphraTest/1.0");
    expect(report).toContain("TypeError: render exploded");
    expect(report).toContain("Component stack:\n  at Widget");
  });
});
