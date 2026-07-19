import { ipc, type SessionArchive, type SessionSummary } from "@/lib/ipc/ipc";

import type { AgentTimelineItem, StartableBackend } from "./types";

export type { SessionArchive, SessionSummary };

export interface PersistSessionInput {
  id: string;
  projectPath: string;
  backend: StartableBackend;
  acpSessionId: string | null;
  createdAt: number;
  items: AgentTimelineItem[];
}

/** Derive a short title from the first user message. */
export function titleFromItems(items: AgentTimelineItem[]): string {
  const user = items.find((item) => item.kind === "user");
  if (!user || user.kind !== "user") return "Untitled session";
  const text = user.text.trim().replace(/\s+/g, " ");
  if (!text) return "Untitled session";
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
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
    title: titleFromItems(input.items),
    backend: input.backend,
    createdAt: input.createdAt,
    updatedAt: now,
    acpSessionId: input.acpSessionId,
    items: input.items,
  };
  return ipc.sessionSave(archive);
}
