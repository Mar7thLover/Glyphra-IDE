/** Crash circuit breaker: trip after N crashes inside a sliding window. */

export const CRASH_WINDOW_MS = 30_000;
export const CRASH_LIMIT = 3;

export interface CircuitState {
  /** Recent crash timestamps (ms since epoch). */
  crashTimes: number[];
  /** When true, further starts/restarts are blocked until reset. */
  open: boolean;
}

export function emptyCircuit(): CircuitState {
  return { crashTimes: [], open: false };
}

/**
 * Record a crash. Returns the next state; `open` becomes true once
 * `CRASH_LIMIT` crashes fall inside `CRASH_WINDOW_MS`.
 */
export function recordCrash(
  state: CircuitState,
  now = Date.now(),
  windowMs = CRASH_WINDOW_MS,
  limit = CRASH_LIMIT,
): CircuitState {
  const crashTimes = [...state.crashTimes.filter((t) => now - t < windowMs), now];
  return {
    crashTimes,
    open: state.open || crashTimes.length >= limit,
  };
}

export function resetCircuit(): CircuitState {
  return emptyCircuit();
}

export function circuitMessage(state: CircuitState): string | null {
  if (!state.open) return null;
  return `Circuit open: ${CRASH_LIMIT} crashes within ${CRASH_WINDOW_MS / 1000}s. Inspect stderr, then reset before restarting.`;
}
