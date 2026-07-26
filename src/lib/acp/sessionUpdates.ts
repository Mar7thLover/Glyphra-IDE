import type { SessionUpdate } from "@agentclientprotocol/sdk";

import type { AgentTimelineItem, AgentToolContent, ToolCallStatus } from "./types";

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

type ToolContentBlock = NonNullable<
  Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>["content"]
>[number];

function parseToolContent(blocks: ToolContentBlock[] | null | undefined): AgentToolContent[] {
  if (!blocks) return [];
  return blocks.flatMap((block): AgentToolContent[] => {
    if (block.type === "diff") {
      return [
        {
          kind: "diff",
          path: block.path,
          oldText: block.oldText ?? null,
          newText: block.newText,
        },
      ];
    }
    if (block.type === "terminal") {
      return [{ kind: "terminal", terminalId: block.terminalId }];
    }
    if (block.content.type === "text") {
      return [{ kind: "text", text: block.content.text }];
    }
    return [];
  });
}

function summarizeToolContent(content: AgentToolContent[]): string | undefined {
  return content
    .map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "diff") return block.path;
      return `Terminal ${block.terminalId}`;
    })
    .filter(Boolean)
    .join("\n") || undefined;
}

/** Apply a typed ACP `session/update` to the timeline (pure). */
export function applySessionUpdate(
  items: AgentTimelineItem[],
  update: SessionUpdate,
): AgentTimelineItem[] {
  const at = Date.now();

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      if (update.content.type !== "text") {
        return [
          ...items,
          { id: nextId("sys"), kind: "system", text: `[${update.content.type}]`, at },
        ];
      }
      const last = items.at(-1);
      if (last?.kind === "assistant") {
        return [...items.slice(0, -1), { ...last, text: last.text + update.content.text }];
      }
      return [...items, { id: nextId("asst"), kind: "assistant", text: update.content.text, at }];
    }
    case "agent_thought_chunk": {
      if (update.content.type !== "text") return items;
      const last = items.at(-1);
      if (last?.kind === "thought") {
        return [...items.slice(0, -1), { ...last, text: last.text + update.content.text }];
      }
      return [...items, { id: nextId("thought"), kind: "thought", text: update.content.text, at }];
    }
    case "tool_call": {
      const content = parseToolContent(update.content);
      return [
        ...items,
        {
          id: nextId("tool"),
          kind: "tool",
          toolCallId: update.toolCallId,
          title: update.title,
          status: (update.status ?? "pending") as ToolCallStatus,
          toolKind: update.kind,
          detail:
            summarizeToolContent(content) ?? update.locations?.map((location) => location.path).join(", "),
          content,
          at,
        },
      ];
    }
    case "tool_call_update": {
      return items.map((item) => {
        if (item.kind !== "tool" || item.toolCallId !== update.toolCallId) return item;
        const content =
          update.content == null ? item.content : parseToolContent(update.content);
        return {
          ...item,
          status: (update.status ?? item.status) as ToolCallStatus,
          title: update.title ?? item.title,
          toolKind: update.kind ?? item.toolKind,
          content,
          detail:
            summarizeToolContent(content ?? []) ??
            update.locations?.map((location) => location.path).join(", ") ??
            item.detail,
        };
      });
    }
    case "plan": {
      return [
        ...items,
        {
          id: nextId("plan"),
          kind: "plan",
          entries: update.entries.map((entry) => ({
            content: entry.content,
            status: entry.status,
          })),
          at,
        },
      ];
    }
    default:
      return items;
  }
}

export function resetTimelineIds() {
  seq = 0;
}
