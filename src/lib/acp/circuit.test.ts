import { describe, expect, it } from "vitest";

import {
  CRASH_LIMIT,
  CRASH_WINDOW_MS,
  circuitMessage,
  emptyCircuit,
  recordCrash,
  resetCircuit,
} from "./circuit";

describe("crash circuit breaker", () => {
  it("stays closed under the limit", () => {
    let state = emptyCircuit();
    const t0 = 1_000_000;
    state = recordCrash(state, t0);
    state = recordCrash(state, t0 + 1_000);
    expect(state.open).toBe(false);
    expect(state.crashTimes).toHaveLength(2);
    expect(circuitMessage(state)).toBeNull();
  });

  it("trips on the Nth crash inside the window", () => {
    let state = emptyCircuit();
    const t0 = 1_000_000;
    for (let i = 0; i < CRASH_LIMIT; i++) {
      state = recordCrash(state, t0 + i * 100);
    }
    expect(state.open).toBe(true);
    expect(state.crashTimes).toHaveLength(CRASH_LIMIT);
    expect(circuitMessage(state)).toMatch(/Circuit open/);
  });

  it("ignores crashes outside the sliding window", () => {
    let state = emptyCircuit();
    const t0 = 1_000_000;
    state = recordCrash(state, t0);
    state = recordCrash(state, t0 + 1_000);
    // Third crash is past the window — prior two drop out.
    state = recordCrash(state, t0 + CRASH_WINDOW_MS + 5_000);
    expect(state.open).toBe(false);
    expect(state.crashTimes).toHaveLength(1);
  });

  it("stays open until reset even after the window slides", () => {
    let state = emptyCircuit();
    const t0 = 1_000_000;
    for (let i = 0; i < CRASH_LIMIT; i++) {
      state = recordCrash(state, t0 + i);
    }
    expect(state.open).toBe(true);
    state = recordCrash(state, t0 + CRASH_WINDOW_MS + 60_000);
    expect(state.open).toBe(true);
    state = resetCircuit();
    expect(state.open).toBe(false);
    expect(state.crashTimes).toHaveLength(0);
  });
});
