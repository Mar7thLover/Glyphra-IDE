export type LineDiffRow =
  | {
      kind: "context" | "add" | "remove";
      text: string;
      oldLine: number | null;
      newLine: number | null;
    }
  | { kind: "hunk"; text: string; oldLine: null; newLine: null };

const MAX_LCS_CELLS = 160_000;
const CONTEXT_LINES = 3;

function lines(text: string | null): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const result = normalized.split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

function rawLineDiff(oldText: string | null, newText: string): LineDiffRow[] {
  const before = lines(oldText);
  const after = lines(newText);
  if ((before.length + 1) * (after.length + 1) > MAX_LCS_CELLS) {
    return [
      ...before.map(
        (text, index): LineDiffRow => ({
          kind: "remove",
          text,
          oldLine: index + 1,
          newLine: null,
        }),
      ),
      ...after.map(
        (text, index): LineDiffRow => ({
          kind: "add",
          text,
          oldLine: null,
          newLine: index + 1,
        }),
      ),
    ];
  }

  const width = after.length + 1;
  const table = new Uint16Array((before.length + 1) * width);
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * width + newIndex;
      table[offset] =
        before[oldIndex] === after[newIndex]
          ? table[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(table[(oldIndex + 1) * width + newIndex], table[offset + 1]);
    }
  }

  const result: LineDiffRow[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < before.length || newIndex < after.length) {
    if (
      oldIndex < before.length &&
      newIndex < after.length &&
      before[oldIndex] === after[newIndex]
    ) {
      result.push({
        kind: "context",
        text: before[oldIndex],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < after.length &&
      (oldIndex >= before.length ||
        table[oldIndex * width + newIndex + 1] >
          table[(oldIndex + 1) * width + newIndex])
    ) {
      result.push({
        kind: "add",
        text: after[newIndex],
        oldLine: null,
        newLine: newIndex + 1,
      });
      newIndex += 1;
    } else {
      result.push({
        kind: "remove",
        text: before[oldIndex],
        oldLine: oldIndex + 1,
        newLine: null,
      });
      oldIndex += 1;
    }
  }
  return result;
}

/** Keep changes plus three context lines and collapse long unchanged regions. */
export function buildLineDiff(oldText: string | null, newText: string): LineDiffRow[] {
  const raw = rawLineDiff(oldText, newText);
  const changed = raw
    .map((row, index) => (row.kind === "add" || row.kind === "remove" ? index : -1))
    .filter((index) => index >= 0);
  if (changed.length === 0) return raw;

  const visible = new Set<number>();
  for (const index of changed) {
    for (
      let nearby = Math.max(0, index - CONTEXT_LINES);
      nearby <= Math.min(raw.length - 1, index + CONTEXT_LINES);
      nearby += 1
    ) {
      visible.add(nearby);
    }
  }

  const compact: LineDiffRow[] = [];
  let omitted = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (!visible.has(index)) {
      omitted += 1;
      continue;
    }
    if (omitted > 0) {
      compact.push({
        kind: "hunk",
        text: `… ${omitted} unchanged line${omitted === 1 ? "" : "s"} …`,
        oldLine: null,
        newLine: null,
      });
      omitted = 0;
    }
    compact.push(raw[index]);
  }
  if (omitted > 0) {
    compact.push({
      kind: "hunk",
      text: `… ${omitted} unchanged line${omitted === 1 ? "" : "s"} …`,
      oldLine: null,
      newLine: null,
    });
  }
  return compact;
}
