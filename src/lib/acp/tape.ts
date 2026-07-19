import type { SessionUpdate } from "@agentclientprotocol/sdk";

import { applySessionUpdate } from "./sessionUpdates";
import type { AgentTimelineItem, PermissionOption } from "./types";

export type UiTapeEvent =
  | { kind: "meta"; name?: string; description?: string }
  | { kind: "update"; t: number; update: SessionUpdate }
  | {
      kind: "permission";
      t: number;
      toolCall: { toolCallId: string; title?: string };
      options: PermissionOption[];
    }
  | { kind: "stop"; t: number; stopReason: string };

/** Parse a UI event tape (fixtures/tapes/*.jsonl). */
export function parseUiTape(text: string): UiTapeEvent[] {
  const events: UiTapeEvent[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const value = JSON.parse(line) as UiTapeEvent;
    if (value.kind === "meta") continue;
    events.push(value);
  }
  return events;
}

export interface ReplayTapeOptions {
  /** Substitute `{{prompt}}` in update payloads. */
  promptText?: string;
  /** Auto-answer permission prompts (default: allow). */
  permissionChoice?: string | "cancelled";
}

function substitutePrompt<T>(value: T, promptText: string): T {
  if (typeof value === "string") {
    return value.replaceAll("{{prompt}}", promptText) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substitutePrompt(entry, promptText)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = substitutePrompt(child, promptText);
    }
    return out as T;
  }
  return value;
}

/**
 * Deterministic, zero-LLM replay: fold tape updates into a timeline.
 * Permission events are resolved via `permissionChoice` (no UI).
 */
export function replayUiTape(
  events: UiTapeEvent[],
  options: ReplayTapeOptions = {},
): { items: AgentTimelineItem[]; stopReason: string; permissions: number } {
  const promptText = options.promptText ?? "hello";
  const permissionChoice = options.permissionChoice ?? "allow";
  let items: AgentTimelineItem[] = [];
  let stopReason = "end_turn";
  let permissions = 0;
  let skipAllowPath = false;

  for (const event of events) {
    if (event.kind === "update") {
      if (skipAllowPath) continue;
      const update = substitutePrompt(event.update, promptText);
      items = applySessionUpdate(items, update);
      continue;
    }
    if (event.kind === "permission") {
      permissions += 1;
      if (permissionChoice === "cancelled") {
        stopReason = "cancelled";
        break;
      }
      const allowed =
        permissionChoice === "allow" || permissionChoice === "allow_always";
      if (!allowed) {
        skipAllowPath = true;
        items = applySessionUpdate(items, {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCall.toolCallId,
          status: "failed",
        });
        items = applySessionUpdate(items, {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Edit rejected — fixture turn complete.",
          },
        });
      }
      continue;
    }
    if (event.kind === "stop") {
      stopReason = event.stopReason;
      break;
    }
  }

  return { items, stopReason, permissions };
}

/** Extract session/update payloads from a wire recorder tape. */
export function sessionUpdatesFromWireTape(text: string): SessionUpdate[] {
  const updates: SessionUpdate[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const row = JSON.parse(line) as { dir?: string; line?: string };
    if (row.dir !== "out" || !row.line) continue;
    let message: { method?: string; params?: { update?: SessionUpdate } };
    try {
      message = JSON.parse(row.line);
    } catch {
      continue;
    }
    if (message.method === "session/update" && message.params?.update) {
      updates.push(message.params.update);
    }
  }
  return updates;
}
