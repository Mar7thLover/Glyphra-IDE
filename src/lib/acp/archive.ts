import { ipc, type SessionArchive, type SessionSummary } from "@/lib/ipc/ipc";

import type {
  AgentConversationCost,
  AgentConversationUsage,
  AgentTimelineItem,
  StartableBackend,
} from "./types";

export type { SessionArchive, SessionSummary };

export interface PersistSessionInput {
  id: string;
  projectPath: string;
  backend: StartableBackend;
  acpSessionId: string | null;
  createdAt: number;
  items: AgentTimelineItem[];
  usage?: AgentConversationUsage | null;
  cost?: AgentConversationCost | null;
  /** Explicit rename; without it the title is re-derived on every save. */
  title?: string | null;
}

/**
 * Build the one-time context handoff used when an agent cannot natively reload
 * a previous ACP session. The local timeline remains the UI source of truth;
 * this text only gives the replacement agent enough conversational context to
 * continue coherently.
 */
export function continuationContext(items: AgentTimelineItem[]): string {
  const transcript = items
    .flatMap((item) => {
      if (item.kind === "user") return [`User: ${item.text}`];
      if (item.kind === "assistant") return [`Assistant: ${item.text}`];
      if (item.kind === "plan") {
        const plan = item.entries.map((entry) => `- [${entry.status}] ${entry.content}`).join("\n");
        return plan ? [`Assistant plan:\n${plan}`] : [];
      }
      return [];
    })
    .join("\n\n")
    .trim();
  if (!transcript) return "";
  return [
    "Continue the existing conversation below. Treat it as prior context and respond only to the new user message that follows.",
    "",
    "<previous_conversation>",
    transcript,
    "</previous_conversation>",
  ].join("\n");
}

export const UNTITLED_SESSION = "Untitled session";

/** Derive a short title from the first user message. */
export function titleFromItems(items: AgentTimelineItem[]): string {
  const user = items.find((item) => item.kind === "user");
  if (!user || user.kind !== "user") return UNTITLED_SESSION;
  const text = user.text.trim().replace(/\s+/g, " ");
  if (!text) return UNTITLED_SESSION;
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/**
 * Label for a session anywhere it is listed. An explicit rename wins, then the
 * first user message; only a conversation with nothing said in it falls back to
 * the agent/backend name.
 */
export function sessionLabel(
  items: AgentTimelineItem[],
  custom: string | null | undefined,
  fallback: string,
): string {
  const renamed = custom?.trim();
  if (renamed) return renamed;
  const derived = titleFromItems(items);
  return derived === UNTITLED_SESSION ? fallback : derived;
}

export async function renameArchive(
  projectPath: string,
  id: string,
  title: string,
): Promise<void> {
  await ipc.sessionRename(projectPath, id, title);
}

export function newArchiveId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listArchives(projectPath: string): Promise<SessionSummary[]> {
  return ipc.sessionList(projectPath);
}

export async function loadArchive(
  projectPath: string,
  id: string,
): Promise<{ meta: SessionArchive; items: AgentTimelineItem[] }> {
  const archive = await ipc.sessionLoad(projectPath, id);
  return {
    meta: archive,
    items: archive.items as AgentTimelineItem[],
  };
}

export async function deleteArchive(projectPath: string, id: string): Promise<void> {
  await ipc.sessionDelete(projectPath, id);
}

export async function persistSession(input: PersistSessionInput): Promise<SessionSummary | null> {
  if (!input.projectPath || input.items.length === 0) return null;
  const now = Date.now();
  const archive: SessionArchive = {
    id: input.id,
    projectPath: input.projectPath,
    title: input.title?.trim() || titleFromItems(input.items),
    backend: input.backend,
    createdAt: input.createdAt,
    updatedAt: now,
    acpSessionId: input.acpSessionId,
    usage: input.usage
      ? {
          totalTokens: input.usage.totalTokens,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          thoughtTokens: input.usage.thoughtTokens ?? null,
          cachedReadTokens: input.usage.cachedReadTokens ?? null,
          cachedWriteTokens: input.usage.cachedWriteTokens ?? null,
        }
      : null,
    cost: input.cost ?? null,
    items: input.items,
  };
  return ipc.sessionSave(archive);
}
