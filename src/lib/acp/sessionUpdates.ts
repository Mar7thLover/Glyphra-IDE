import type { SessionUpdate } from "@agentclientprotocol/sdk";

import type { AgentTimelineItem, ToolCallStatus } from "./types";

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
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
      return [
        ...items,
        {
          id: nextId("sys"),
          kind: "system",
          text: `💭 ${update.content.text}`,
          at,
        },
      ];
    }
    case "tool_call": {
      return [
        ...items,
        {
          id: nextId("tool"),
          kind: "tool",
          toolCallId: update.toolCallId,
          title: update.title,
          status: (update.status ?? "pending") as ToolCallStatus,
          toolKind: update.kind,
          detail: update.locations?.map((l) => l.path).join(", "),
          at,
        },
      ];
    }
    case "tool_call_update": {
      return items.map((item) => {
        if (item.kind !== "tool" || item.toolCallId !== update.toolCallId) return item;
        return {
          ...item,
          status: (update.status ?? item.status) as ToolCallStatus,
          title: update.title ?? item.title,
          detail:
            update.content
              ?.map((block) => {
                if (block.type === "content" && block.content.type === "text") {
                  return block.content.text;
                }
                return null;
              })
              .filter(Boolean)
              .join("\n") || item.detail,
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
