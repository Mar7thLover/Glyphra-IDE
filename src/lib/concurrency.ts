/**
 * `Promise.all(items.map(…))` starts every task at once. When a task is an IPC
 * call that spawns a subprocess or reads a whole file, that turns a large list
 * into thousands of simultaneous processes and buffers — enough to take the
 * host machine down before any single task finishes.
 *
 * Runs `task` over `items` with at most `limit` in flight, preserving input
 * order in the result. A rejecting task rejects the whole call, exactly like
 * `Promise.all`; callers that want partial results should catch inside `task`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;

  const drain = async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      results[index] = await task(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: workers }, drain));
  return results;
}
