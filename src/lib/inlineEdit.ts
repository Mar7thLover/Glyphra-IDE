/**
 * Inline agent editing primitives (Ctrl+K rewrite and ghost-text completion).
 *
 * Everything here is pure so the prompt shape and — more importantly — the
 * parsing of untrusted harness replies stay unit-testable. The agent runs in a
 * hidden session (see `@/lib/acp/inlineAgent`) and answers with prose we have to
 * reduce back to exactly the code that replaces the user's selection.
 */

/** Hard caps so a runaway reply can never be spliced into a buffer wholesale. */
export const INLINE_EDIT_MAX_SELECTION = 24_000;
export const INLINE_EDIT_MAX_RESULT = 48_000;
export const GHOST_TEXT_MAX_LINES = 6;
export const GHOST_TEXT_MAX_CHARS = 600;
/** Context lines sent around the target range. */
export const INLINE_EDIT_CONTEXT_LINES = 40;
export const GHOST_TEXT_PREFIX_LINES = 60;
export const GHOST_TEXT_SUFFIX_LINES = 20;

export interface InlineEditRequest {
  /** Project-relative path when known, otherwise the file name. */
  path: string;
  /** CodeMirror language name, used only as a fence hint. */
  language: string | null;
  /** The exact text being replaced. */
  selection: string;
  /** Whole-document text before the selection, already trimmed to a window. */
  before: string;
  /** Whole-document text after the selection, already trimmed to a window. */
  after: string;
  /** The user's natural-language instruction. */
  instruction: string;
}

export interface GhostTextRequest {
  path: string;
  language: string | null;
  before: string;
  after: string;
}

function fenceLanguage(language: string | null) {
  if (!language) return "";
  return language.toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
}

/** Take at most `count` lines from the end of `text`. */
export function tailLines(text: string, count: number): string {
  if (count <= 0) return "";
  const lines = text.split("\n");
  return lines.length <= count ? text : lines.slice(lines.length - count).join("\n");
}

/** Take at most `count` lines from the start of `text`. */
export function headLines(text: string, count: number): string {
  if (count <= 0) return "";
  const lines = text.split("\n");
  return lines.length <= count ? text : lines.slice(0, count).join("\n");
}

export function buildInlineEditPrompt(request: InlineEditRequest): string {
  const fence = fenceLanguage(request.language);
  const kind = request.selection ? "SELECTION" : "INSERTION POINT";
  return [
    "You are an inline code editor inside the Glyphra IDE.",
    "Rewrite only the marked region of the file below and reply with nothing else.",
    "",
    "Rules:",
    `- Reply with exactly one \`\`\`${fence || "code"} fenced block containing the replacement for the ${kind}.`,
    "- Do not explain, apologize, greet, or add commentary before or after the block.",
    "- Do not use any tools; answer from the context provided here.",
    "- Preserve the surrounding indentation style and the file's existing conventions.",
    "- Return the complete replacement, not a diff and not an excerpt with ellipses.",
    "- If the instruction cannot be satisfied, reply with the region unchanged.",
    "",
    `File: ${request.path}`,
    "",
    "Context before:",
    `\`\`\`${fence}`,
    request.before,
    "```",
    "",
    `${kind === "SELECTION" ? "Region to rewrite" : "Insert at this point"}:`,
    `\`\`\`${fence}`,
    request.selection,
    "```",
    "",
    "Context after:",
    `\`\`\`${fence}`,
    request.after,
    "```",
    "",
    "Instruction:",
    request.instruction.trim(),
  ].join("\n");
}

export function buildGhostTextPrompt(request: GhostTextRequest): string {
  const fence = fenceLanguage(request.language);
  return [
    "You are an inline completion engine inside the Glyphra IDE.",
    "Continue the code at the <CURSOR> marker and reply with nothing else.",
    "",
    "Rules:",
    `- Reply with exactly one \`\`\`${fence || "code"} fenced block containing only the text to insert at <CURSOR>.`,
    "- Never repeat text that already appears before the cursor.",
    `- Keep the completion short: at most ${GHOST_TEXT_MAX_LINES} lines.`,
    "- Do not explain and do not use any tools.",
    "- If nothing useful can be added, reply with an empty fenced block.",
    "",
    `File: ${request.path}`,
    "",
    `\`\`\`${fence}`,
    `${request.before}<CURSOR>${request.after}`,
    "```",
  ].join("\n");
}

/**
 * Reduce a harness reply to the code it proposed.
 *
 * Prefers the largest fenced block, falls back to the raw reply when the harness
 * answered without a fence. Returns null when nothing usable survives.
 */
export function extractCodeBlock(reply: string): string | null {
  const normalized = reply.replace(/\r\n/g, "\n");
  const blocks = [...normalized.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
  if (blocks.length > 0) {
    // An unchanged-region reply is legitimately empty; keep the longest block so
    // a leading "here is the diff" sample does not win over the real answer.
    let best = blocks[0];
    for (const block of blocks) if (block.length > best.length) best = block;
    return best.replace(/\n$/, "");
  }
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  // A reply that is clearly prose (sentences, no code punctuation) is a refusal
  // or a clarifying question — surfacing it as code would corrupt the buffer.
  if (!/[\n{};()=<>[\]]/.test(trimmed) && /\s/.test(trimmed) && trimmed.length < 400) {
    return null;
  }
  return trimmed;
}

/**
 * Align an agent reply with the buffer it will be spliced into: match the
 * document's line endings and keep the selection's trailing-newline shape so
 * replacing a whole line does not swallow or duplicate the break.
 */
export function normalizeInlineResult(selection: string, result: string): string {
  const crlf = selection.includes("\r\n");
  let next = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const selectionEndedWithNewline = /\n$/.test(selection.replace(/\r\n/g, "\n"));
  next = next.replace(/\n+$/, "");
  if (selectionEndedWithNewline) next += "\n";
  return crlf ? next.replace(/\n/g, "\r\n") : next;
}

/**
 * Clean a completion suggestion before it is shown as ghost text: strip a
 * duplicated prefix, bound its size, and drop it entirely when it is empty or
 * merely echoes what the user already typed.
 */
export function sanitizeGhostText(before: string, suggestion: string): string | null {
  let next = suggestion.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!next.trim()) return null;

  // Harnesses often echo the current line before continuing it.
  const currentLine = before.slice(before.lastIndexOf("\n") + 1);
  if (currentLine && next.startsWith(currentLine)) {
    next = next.slice(currentLine.length);
  } else {
    const trimmedLine = currentLine.trimStart();
    if (trimmedLine && next.trimStart().startsWith(trimmedLine)) {
      const offset = next.indexOf(trimmedLine) + trimmedLine.length;
      next = next.slice(offset);
    }
  }
  if (!next || !next.trim()) return null;

  const lines = next.split("\n");
  if (lines.length > GHOST_TEXT_MAX_LINES) {
    next = lines.slice(0, GHOST_TEXT_MAX_LINES).join("\n");
  }
  if (next.length > GHOST_TEXT_MAX_CHARS) {
    next = next.slice(0, GHOST_TEXT_MAX_CHARS);
  }
  return next.trim() ? next : null;
}

/**
 * Ghost text is only useful — and only cheap enough — at a collapsed cursor that
 * is not sitting in the middle of a word.
 */
export function shouldRequestGhostText(options: {
  enabled: boolean;
  hasSelection: boolean;
  composing: boolean;
  readOnly: boolean;
  charBefore: string;
  charAfter: string;
}): boolean {
  if (!options.enabled || options.hasSelection || options.composing || options.readOnly) {
    return false;
  }
  // Mid-identifier the regular completion popup is the better affordance.
  if (/[A-Za-z0-9_$]/.test(options.charAfter)) return false;
  return options.charBefore !== "";
}
