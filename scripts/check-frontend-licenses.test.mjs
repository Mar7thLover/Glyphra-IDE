import { describe, expect, it } from "vitest";

import { isAllowedLicense } from "./check-frontend-licenses.mjs";

describe("frontend license policy", () => {
  it("accepts approved SPDX alternatives", () => {
    expect(isAllowedLicense("MIT OR Apache-2.0")).toBe(true);
    expect(isAllowedLicense("(MPL-2.0 OR Apache-2.0)")).toBe(true);
  });

  it("rejects copyleft and missing metadata", () => {
    expect(isAllowedLicense("GPL-3.0-only")).toBe(false);
    expect(isAllowedLicense("Unknown")).toBe(false);
  });
});
