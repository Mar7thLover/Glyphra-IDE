import { describe, expect, it } from "vitest";

import { placePillMenu } from "./PillSelect";

describe("placePillMenu", () => {
  it("keeps a right-edge menu inside the viewport", () => {
    const placement = placePillMenu(
      { left: 1800, right: 1900, top: 900, bottom: 924 },
      240,
      1920,
      1080,
    );

    expect(placement.left).toBe(1688);
    expect(placement.left + placement.width).toBe(1912);
    expect(placement.opensUp).toBe(true);
  });

  it("opens downward when there is not enough room above", () => {
    const placement = placePillMenu(
      { left: 24, right: 120, top: 20, bottom: 44 },
      200,
      800,
      600,
    );

    expect(placement.opensUp).toBe(false);
    expect(placement.top).toBe(50);
  });

  it("shrinks the menu on narrow viewports", () => {
    const placement = placePillMenu(
      { left: 120, right: 170, top: 300, bottom: 324 },
      120,
      180,
      500,
    );

    expect(placement.left).toBe(8);
    expect(placement.width).toBe(164);
  });
});
