export interface UnifiedPatchFile {
  oldPath: string;
  newPath: string;
  diff: string;
}

interface ParsedHunk {
  oldStart: number;
  lines: string[];
}

function normalizeDiffPath(value: string) {
  const path = value.trim().split(/\s+/)[0] ?? "";
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "").replace(/\\/g, "/");
}

export function parseUnifiedPatchFiles(diff: string): UnifiedPatchFile[] {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const files: UnifiedPatchFile[] = [];
  let start = -1;
  let oldPath = "";

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("--- ")) continue;
    if (start >= 0 && oldPath) {
      const chunk = lines.slice(start, index).join("\n");
      const newLine = lines[start + 1] ?? "";
      if (newLine.startsWith("+++ ")) {
        files.push({
          oldPath,
          newPath: normalizeDiffPath(newLine.slice(4)),
          diff: chunk,
        });
      }
    }
    start = index;
    oldPath = normalizeDiffPath(lines[index].slice(4));
  }
  if (start >= 0 && oldPath) {
    const newLine = lines[start + 1] ?? "";
    if (newLine.startsWith("+++ ")) {
      files.push({
        oldPath,
        newPath: normalizeDiffPath(newLine.slice(4)),
        diff: lines.slice(start).join("\n"),
      });
    }
  }
  return files;
}

function parseHunks(diff: string): ParsedHunk[] {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  for (const line of lines) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (header) {
      current = { oldStart: Number(header[1]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (current && (/^[ +\\-]/.test(line) || line === "")) {
      current.lines.push(line);
    }
  }
  return hunks;
}

/** Apply a text unified diff only when every context/deletion line still matches. */
export function applyUnifiedPatch(source: string, diff: string): string {
  const hunks = parseHunks(diff);
  if (hunks.length === 0) throw new Error("Suggested diff contains no hunks");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalEol = source.endsWith("\n");
  const sourceLines = source.replace(/\r\n/g, "\n").split("\n");
  if (hadFinalEol) sourceLines.pop();
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const target = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    if (target < cursor || target > sourceLines.length) {
      throw new Error("Suggested diff hunk is outside the current file");
    }
    output.push(...sourceLines.slice(cursor, target));
    cursor = target;

    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue;
      const marker = line[0] || " ";
      const value = line.slice(1);
      if (marker === "+") {
        output.push(value);
        continue;
      }
      if (marker !== " " && marker !== "-") continue;
      if (sourceLines[cursor] !== value) {
        throw new Error(
          `Suggested diff no longer matches line ${cursor + 1}; regenerate it before applying`,
        );
      }
      if (marker === " ") output.push(value);
      cursor += 1;
    }
  }
  output.push(...sourceLines.slice(cursor));
  const result = output.join(eol);
  return hadFinalEol ? `${result}${eol}` : result;
}

export function safeProjectRelativePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return null;
  }
  return normalized;
}
