export type ComposerReferenceKind = "selection" | "code" | "file";

export interface ComposerReference {
  id: string;
  kind: ComposerReferenceKind;
  label: string;
  content: string;
  path?: string;
}

export interface SlashMatch {
  start: number;
  end: number;
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

export function composeAgentPrompt(draft: string, references: ComposerReference[]): string {
  const prompt = expandSlashCommand(draft);
  if (references.length === 0) return prompt;
  const blocks = references.map((reference) => {
    const path = reference.path ? ` path=${JSON.stringify(reference.path)}` : "";
    return `<reference kind=${JSON.stringify(reference.kind)} label=${JSON.stringify(reference.label)}${path}>\n${escapeReferenceContent(reference.content)}\n</reference>`;
  });
  return `${prompt}\n\n<glyphra_references>\n${blocks.join("\n")}\n</glyphra_references>`.trim();
}
