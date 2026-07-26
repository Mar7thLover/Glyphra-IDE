export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticSource = "editor" | "build" | "terminal" | "agent" | "lsp";

export interface GlyphraDiagnostic {
  id: string;
  path: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  source: DiagnosticSource;
  code?: string;
  at: number;
}

const ANSI_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, "").replace(/\r/g, "");
}

function collapsePath(value: string) {
  const prefix = value.match(/^[A-Za-z]:\//)?.[0] ?? (value.startsWith("/") ? "/" : "");
  const body = prefix ? value.slice(prefix.length) : value;
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${prefix}${parts.join("/")}`;
}

export function resolveDiagnosticPath(cwd: string, value: string): string | null {
  const raw = value
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^webpack:\/\//i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/");
  if (!raw || raw.startsWith("<") || raw.includes("\0")) return null;
  const root = collapsePath(cwd.replace(/\\/g, "/").replace(/\/+$/, ""));
  const absolute = /^[A-Za-z]:\//.test(raw) || raw.startsWith("/");
  const candidate = collapsePath(absolute ? raw : `${root}/${raw.replace(/^\.\//, "")}`);
  const rootKey = root.toLowerCase();
  const candidateKey = candidate.toLowerCase();
  if (candidateKey !== rootKey && !candidateKey.startsWith(`${rootKey}/`)) return null;
  return candidate;
}

function sourceForLine(source: DiagnosticSource, line: string): DiagnosticSource {
  if (
    source === "terminal"
    && /\b(?:error|warning|TS\d{3,}|cargo|rustc|vite|webpack|eslint|clang|gcc)\b/i.test(line)
  ) {
    return "build";
  }
  return source;
}

function diagnostic(
  cwd: string,
  rawPath: string,
  line: string,
  column: string,
  severity: DiagnosticSeverity,
  message: string,
  source: DiagnosticSource,
  code?: string,
): GlyphraDiagnostic | null {
  const path = resolveDiagnosticPath(cwd, rawPath);
  if (!path) return null;
  const row = Math.max(1, Number(line) || 1);
  const col = Math.max(1, Number(column) || 1);
  const cleanMessage = message.trim() || "Diagnostic";
  const cleanCode = code?.trim() || undefined;
  const effectiveSource = sourceForLine(source, `${severity} ${cleanCode ?? ""} ${cleanMessage}`);
  return {
    id: [
      effectiveSource,
      path.toLowerCase(),
      row,
      col,
      severity,
      cleanCode ?? "",
      cleanMessage,
    ].join(":"),
    path,
    line: row,
    column: col,
    severity,
    message: cleanMessage,
    source: effectiveSource,
    code: cleanCode,
    at: Date.now(),
  };
}

/** Parse common TypeScript, GCC/Clang, Rust and ESLint diagnostic formats. */
export function parseDiagnosticText(
  text: string,
  source: Exclude<DiagnosticSource, "editor">,
  cwd: string,
): GlyphraDiagnostic[] {
  const lines = stripAnsi(text).split("\n");
  const output: GlyphraDiagnostic[] = [];
  let pending:
    | { severity: DiagnosticSeverity; message: string; code?: string }
    | null = null;
  let eslintPath: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const paren = line.match(
      /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s*([A-Za-z]+\d+)?\s*:?\s*(.*)$/i,
    );
    if (paren) {
      const item = diagnostic(
        cwd,
        paren[1],
        paren[2],
        paren[3],
        paren[4].toLowerCase() as DiagnosticSeverity,
        paren[6],
        source,
        paren[5],
      );
      if (item) output.push(item);
      pending = null;
      continue;
    }

    const colon = line.match(
      /^(.+?):(\d+):(\d+)\s*(?:-|:)?\s*(error|warning|info)\s*([A-Za-z]+\d+|\[[^\]]+\])?\s*:?\s*(.*)$/i,
    );
    if (colon) {
      const item = diagnostic(
        cwd,
        colon[1],
        colon[2],
        colon[3],
        colon[4].toLowerCase() as DiagnosticSeverity,
        colon[6],
        source,
        colon[5]?.replace(/^\[|\]$/g, ""),
      );
      if (item) output.push(item);
      pending = null;
      continue;
    }

    const rustMessage = line.match(
      /^\s*(error|warning)(?:\[([^\]]+)\])?:\s*(.+)$/i,
    );
    if (rustMessage) {
      pending = {
        severity: rustMessage[1].toLowerCase() as DiagnosticSeverity,
        code: rustMessage[2],
        message: rustMessage[3],
      };
      continue;
    }

    const rustLocation = line.match(/^\s*-->\s+(.+?):(\d+):(\d+)\s*$/);
    if (rustLocation && pending) {
      const item = diagnostic(
        cwd,
        rustLocation[1],
        rustLocation[2],
        rustLocation[3],
        pending.severity,
        pending.message,
        source,
        pending.code,
      );
      if (item) output.push(item);
      pending = null;
      continue;
    }

    const possiblePath = line.trim();
    if (
      !/^\d+:\d+/.test(possiblePath)
      && /\.(?:[cm]?[jt]sx?|vue|svelte|py|rs|go|java|kt|cs|cpp|cc|c|h)$/i.test(possiblePath)
      && resolveDiagnosticPath(cwd, possiblePath)
    ) {
      eslintPath = possiblePath;
      continue;
    }
    const eslint = line.match(
      /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/i,
    );
    if (eslint && eslintPath) {
      const item = diagnostic(
        cwd,
        eslintPath,
        eslint[1],
        eslint[2],
        eslint[3].toLowerCase() as DiagnosticSeverity,
        eslint[4],
        source,
        eslint[5],
      );
      if (item) output.push(item);
    }
  }

  return [...new Map(output.map((item) => [item.id, item])).values()];
}

function offsetToLineColumn(content: string, offset: number) {
  const prefix = content.slice(0, Math.max(0, Math.min(content.length, offset)));
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/** Fast diagnostics that do not require an LSP or worker. */
export function analyzeEditorDocument(path: string, content: string): GlyphraDiagnostic[] {
  const output: GlyphraDiagnostic[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(line)) {
      output.push({
        id: `editor:${path.toLowerCase()}:${index + 1}:conflict`,
        path,
        line: index + 1,
        column: 1,
        severity: "error",
        message: "Unresolved merge conflict marker",
        source: "editor",
        code: "merge-conflict",
        at: Date.now(),
      });
    }
    const nul = line.indexOf("\0");
    if (nul >= 0) {
      output.push({
        id: `editor:${path.toLowerCase()}:${index + 1}:${nul + 1}:nul`,
        path,
        line: index + 1,
        column: nul + 1,
        severity: "error",
        message: "Unexpected NUL character",
        source: "editor",
        code: "nul-character",
        at: Date.now(),
      });
    }
  });

  if (/\.json$/i.test(path) && content.trim()) {
    try {
      JSON.parse(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const position = Number(message.match(/\bposition\s+(\d+)/i)?.[1] ?? 0);
      const explicit = message.match(/\bline\s+(\d+)\s+column\s+(\d+)/i);
      const location = explicit
        ? { line: Number(explicit[1]), column: Number(explicit[2]) }
        : offsetToLineColumn(content, position);
      output.push({
        id: `editor:${path.toLowerCase()}:${location.line}:${location.column}:json`,
        path,
        line: location.line,
        column: location.column,
        severity: "error",
        message: `Invalid JSON: ${message}`,
        source: "editor",
        code: "json-parse",
        at: Date.now(),
      });
    }
  }
  return output;
}

export function diagnosticCounts(diagnostics: GlyphraDiagnostic[]) {
  return diagnostics.reduce(
    (counts, item) => {
      counts[item.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}
