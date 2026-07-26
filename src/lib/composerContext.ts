export type ComposerReferenceKind =
  | "selection"
  | "code"
  | "file"
  | "folder"
  | "symbol"
  | "rule";

export interface ComposerReference {
  id: string;
  kind: ComposerReferenceKind;
  label: string;
  content: string;
  path?: string;
  relativePath?: string;
  line?: number;
}

export interface SlashMatch {
  start: number;
  end: number;
  query: string;
}

export interface MentionMatch {
  start: number;
  end: number;
  kind: "file" | "folder" | "symbol" | null;
  query: string;
}

export function findSlashMatch(value: string, cursor: number): SlashMatch | null {
  const beforeCursor = value.slice(0, cursor);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const line = beforeCursor.slice(lineStart);
  const match = line.match(/^(\s*)\/(\S*)$/);
  if (!match) return null;
  const slashOffset = match[1].length;
  return {
    start: lineStart + slashOffset,
    end: cursor,
    query: match[2].toLowerCase(),
  };
}

export function replaceSlashMatch(value: string, match: SlashMatch, replacement: string) {
  const next = `${value.slice(0, match.start)}${replacement}${value.slice(match.end)}`;
  return { value: next, cursor: match.start + replacement.length };
}

/**
 * Find the @ token immediately before the caret. Mentions may appear anywhere
 * after whitespace and optionally use an explicit scope.
 */
export function findMentionMatch(value: string, cursor: number): MentionMatch | null {
  if (cursor < 0) return null;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@(?:(file|folder|symbol):)?([^\s@]*)$/i);
  if (!match) return null;
  const leadingWhitespace = match[1].length;
  const start = beforeCursor.length - match[0].length + leadingWhitespace;
  return {
    start,
    end: cursor,
    kind: (match[2]?.toLowerCase() as MentionMatch["kind"]) ?? null,
    query: match[3].toLowerCase(),
  };
}

export function replaceMentionMatch(value: string, match: MentionMatch, replacement = "") {
  const next = `${value.slice(0, match.start)}${replacement}${value.slice(match.end)}`;
  return { value: next, cursor: match.start + replacement.length };
}

const COMMAND_PROMPTS: Record<string, string> = {
  review: "Review the current changes and call out correctness, regression, and test risks.",
  explain: "Explain the referenced context clearly and concisely.",
  test: "Add or suggest focused tests for the current changes.",
  fix: "Find and fix the issues in the referenced context.",
  translate:
    "Translate the referenced text, keeping technical terms such as Agent, Skill, MCP, API, CLI, IDE, Git, Codex, Token, Prompt, Provider, TypeScript, Rust, React, and Tauri unchanged.",
};

export function expandSlashCommand(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\/(review|explain|test|fix|translate)(?:\s+([\s\S]*))?$/i);
  if (match) {
    const rest = match[2]?.trim();
    return rest ? `${COMMAND_PROMPTS[match[1].toLowerCase()]}\n\n${rest}` : COMMAND_PROMPTS[match[1].toLowerCase()];
  }

  const skill = trimmed.match(/^\/skill\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (skill) {
    const rest = skill[2]?.trim();
    const instruction = `Use the $${skill[1]} Skill for this task.`;
    return rest ? `${instruction}\n\n${rest}` : instruction;
  }

  const mcp = trimmed.match(/^\/mcp\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (mcp) {
    const rest = mcp[2]?.trim();
    const instruction = `Use the "${mcp[1]}" MCP server when relevant.`;
    return rest ? `${instruction}\n\n${rest}` : instruction;
  }
  return trimmed;
}

function escapeReferenceContent(value: string) {
  return value.replaceAll("</reference>", "&lt;/reference&gt;");
}

export const MAX_REFERENCE_CHARS = 24_000;

/** Cap an inlined reference so a large file can't blow up the prompt. */
export function truncateReferenceContent(content: string, max = MAX_REFERENCE_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n… [truncated ${max} of ${content.length} chars]`;
}

interface OpenReferenceBuffer {
  path: string;
  content: string;
}

export interface IndexedReferenceFile {
  path: string;
  relativePath: string;
}

export interface ReferenceHydrationOptions {
  indexedFiles?: IndexedReferenceFile[];
}

const MAX_FOLDER_FILES = 12;
const MAX_FOLDER_FILE_CHARS = 8_000;
export const MAX_FOLDER_REFERENCE_CHARS = 48_000;
const SYMBOL_CONTEXT_LINES_BEFORE = 5;
const SYMBOL_CONTEXT_LINES_AFTER = 8;

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function openBufferContent(openBuffers: OpenReferenceBuffer[], path: string) {
  const normalized = normalizePath(path).toLowerCase();
  return openBuffers.find(
    (buffer) => normalizePath(buffer.path).toLowerCase() === normalized,
  )?.content;
}

async function readReferenceContent(
  openBuffers: OpenReferenceBuffer[],
  path: string,
  readFile: (path: string) => Promise<string>,
) {
  const open = openBufferContent(openBuffers, path);
  return open ?? readFile(path);
}

export function extractSymbolContext(content: string, line: number): string {
  const lines = content.split(/\r?\n/);
  const target = Math.max(0, Math.min(lines.length - 1, line - 1));
  const start = Math.max(0, target - SYMBOL_CONTEXT_LINES_BEFORE);
  const end = Math.min(lines.length, target + SYMBOL_CONTEXT_LINES_AFTER + 1);
  const width = String(end).length;
  return lines
    .slice(start, end)
    .map((value, index) => {
      const number = start + index + 1;
      const marker = number === target + 1 ? ">" : " ";
      return `${marker} ${String(number).padStart(width, " ")} | ${value}`;
    })
    .join("\n");
}

async function hydrateFolderReference(
  reference: ComposerReference,
  openBuffers: OpenReferenceBuffer[],
  readFile: (path: string) => Promise<string>,
  indexedFiles: IndexedReferenceFile[],
): Promise<ComposerReference> {
  const relativeFolder = normalizePath(reference.relativePath ?? "");
  if (!relativeFolder) return reference;
  const prefix = `${relativeFolder}/`.toLowerCase();
  const matching = indexedFiles.filter((file) =>
    normalizePath(file.relativePath).toLowerCase().startsWith(prefix),
  );
  const candidates = matching.slice(0, MAX_FOLDER_FILES);
  const blocks: string[] = [];
  let used = 0;
  let unreadable = 0;

  for (const file of candidates) {
    try {
      const raw = await readReferenceContent(openBuffers, file.path, readFile);
      const content = truncateReferenceContent(raw, MAX_FOLDER_FILE_CHARS);
      const block = `--- ${file.relativePath} ---\n${content}`;
      if (used + block.length > MAX_FOLDER_REFERENCE_CHARS) break;
      blocks.push(block);
      used += block.length;
    } catch {
      unreadable += 1;
    }
  }

  const notes = [
    matching.length > candidates.length
      ? `[folder truncated: included at most ${MAX_FOLDER_FILES} of ${matching.length} files]`
      : null,
    unreadable > 0 ? `[${unreadable} unreadable or binary files omitted]` : null,
  ].filter((value): value is string => Boolean(value));
  if (blocks.length === 0) return reference;
  return {
    ...reference,
    content: [`Folder: ${reference.relativePath}`, ...notes, ...blocks].join("\n\n"),
  };
}

/**
 * Resolve repository context chips at send time. Open buffers win over disk so
 * unsaved edits are represented exactly; unreadable content keeps its
 * path/signature placeholder.
 */
export async function hydrateFileReferences(
  references: ComposerReference[],
  openBuffers: OpenReferenceBuffer[],
  readFile: (path: string) => Promise<string>,
  options: ReferenceHydrationOptions = {},
): Promise<ComposerReference[]> {
  return Promise.all(
    references.map(async (reference) => {
      if (reference.kind === "folder") {
        return hydrateFolderReference(
          reference,
          openBuffers,
          readFile,
          options.indexedFiles ?? [],
        );
      }
      if (
        !["file", "rule", "symbol"].includes(reference.kind) ||
        !reference.path
      ) {
        return reference;
      }
      try {
        const content = await readReferenceContent(openBuffers, reference.path, readFile);
        if (reference.kind === "symbol" && reference.line) {
          return {
            ...reference,
            content: `${reference.path}:${reference.line}\n${extractSymbolContext(
              content,
              reference.line,
            )}`,
          };
        }
        return { ...reference, content: truncateReferenceContent(content) };
      } catch {
        return reference;
      }
    }),
  );
}

export function composeAgentPrompt(draft: string, references: ComposerReference[]): string {
  const prompt = expandSlashCommand(draft);
  if (references.length === 0) return prompt;
  const blocks = references.map((reference) => {
    const path = reference.path ? ` path=${JSON.stringify(reference.path)}` : "";
    return `<reference kind=${JSON.stringify(reference.kind)} label=${JSON.stringify(reference.label)}${path}>\n${escapeReferenceContent(reference.content)}\n</reference>`;
  });
  return `${prompt}\n\n<glyphra_references>\n${blocks.join("\n")}\n</glyphra_references>`.trim();
}
