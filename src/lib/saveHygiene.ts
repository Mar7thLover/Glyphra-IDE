export interface SaveHygieneOptions {
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  removeFinalNewline?: boolean;
  formatOnSave: boolean;
  tabSize: number;
  endOfLine?: "lf" | "cr" | "crlf";
}

function lineEndingOf(content: string) {
  if (content.includes("\r\n")) return "\r\n";
  if (content.includes("\r")) return "\r";
  return "\n";
}

function formatSupportedDocument(path: string, content: string, tabSize: number) {
  if (!/\.json$/i.test(path) || !content.trim()) return content;
  try {
    return JSON.stringify(JSON.parse(content), null, tabSize);
  } catch {
    // Save invalid JSON exactly as edited; the diagnostics gutter reports it.
    return content;
  }
}

export function prepareContentForSave(
  path: string,
  content: string,
  options: SaveHygieneOptions,
) {
  const eol =
    options.endOfLine === "crlf"
      ? "\r\n"
      : options.endOfLine === "cr"
        ? "\r"
        : options.endOfLine === "lf"
          ? "\n"
          : lineEndingOf(content);
  let next = options.formatOnSave
    ? formatSupportedDocument(path, content, options.tabSize)
    : content;
  // JSON.stringify uses LF regardless of the original file. Normalizing here
  // also applies an explicit EditorConfig end_of_line setting.
  next = next.replace(/\r\n|\r|\n/g, eol);
  if (options.trimTrailingWhitespace) {
    next = next
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join(eol);
  }
  if (options.insertFinalNewline && next.length > 0 && !next.endsWith(eol)) {
    next += eol;
  } else if (options.removeFinalNewline) {
    while (next.endsWith(eol)) {
      next = next.slice(0, -eol.length);
    }
  }
  return next;
}
