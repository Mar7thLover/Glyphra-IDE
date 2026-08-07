import type { McpServer } from "@agentclientprotocol/sdk";

export type AgentBackendKind =
  | "codex-acp"
  | "claude-acp"
  | "pi-agent"
  | "opencode-acp"
  | "custom-agent";

export type StartableBackend = AgentBackendKind | "auto" | `custom:${string}`;

/** Maps to INITIAL_AGENT_MODE / session set_mode. */
export type AgentPermissionMode = "safe" | "standard" | "unleashed";

export interface AgentStartOptions {
  providerId?: string | null;
  mode?: AgentPermissionMode;
  harness?: AgentHarnessLaunch;
  model?: string | null;
  reasoningEffort?: string | null;
  contextWindow?: number | null;
  fastMode?: boolean;
  approvalReviewer?: AgentApprovalReviewer;
  prewarmedSessionId?: string | null;
  /** Enabled app-managed MCP servers passed through ACP session setup. */
  mcpServers?: McpServer[];
  /** Reattach a persisted conversation instead of creating an empty one. */
  restore?: AgentSessionRestore;
}

export interface AgentSessionRestore {
  archiveId: string;
  acpSessionId: string | null;
  createdAt: number;
  items: AgentTimelineItem[];
  usage?: AgentConversationUsage | null;
  cost?: AgentConversationCost | null;
}

export interface AgentAvailableCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export interface AgentConversationUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface AgentConversationCost {
  amount: number;
  currency: string;
}

export type AgentApprovalReviewer = "user" | "auto_review";

export type CustomAgentProtocol =
  | "acp"
  | "codex-app-server"
  | "claude-stream-json"
  | "pi-json"
  | "stdio-jsonl"
  | "shell-command"
  | "openai-responses"
  | "openai-chat"
  | "anthropic-messages";

export interface AgentHarnessLaunch {
  protocol: CustomAgentProtocol;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  endpoint?: string | null;
  model?: string | null;
}

export interface CustomAgentHarness {
  id: string;
  name: string;
  command: string;
  args: string[];
  protocol: CustomAgentProtocol;
  env: Record<string, string>;
  endpoint?: string;
  model?: string;
  notes?: string;
}

export interface AgentBackendDescriptor {
  kind: AgentBackendKind;
  label: string;
  installed: boolean;
  detail?: string;
}

export const builtinAgentBackends: AgentBackendDescriptor[] = [
  {
    kind: "codex-acp",
    label: "Codex CLI",
    installed: false,
    detail: "Best for OpenAI-compatible custom providers (Responses API).",
  },
  {
    kind: "claude-acp",
    label: "Claude Code",
    installed: false,
    detail: "Best for Claude subscription/API-key workflows.",
  },
  {
    kind: "pi-agent",
    label: "Pi Coding Agent",
    installed: false,
    detail: "MIT agent toolkit: pi-ai providers, pi-agent-core runtime, pi-coding-agent CLI.",
  },
  {
    kind: "custom-agent",
    label: "Custom Agent Harness",
    installed: false,
    detail: "Any ACP/stdio-jsonl/shell-command coding agent harness.",
  },
];

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type AgentToolContent =
  | { kind: "text"; text: string }
  | { kind: "diff"; path: string; oldText: string | null; newText: string }
  | { kind: "terminal"; terminalId: string };

export interface AgentImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** Base64 payload without a data-URL prefix. */
  data: string;
}

export type AgentTimelineItem =
  | {
      id: string;
      kind: "user";
      /** User-facing text; large inlined context stays in promptText. */
      text: string;
      /** Exact text sent to the harness, retained for deterministic retry. */
      promptText?: string;
      checkpointId?: string;
      images?: AgentImageAttachment[];
      at: number;
    }
  | { id: string; kind: "assistant"; text: string; at: number }
  | {
      id: string;
      kind: "system";
      text: string;
      /**
       * Why this note exists. `config` marks a switch the user made (provider,
       * model, effort, permissions); `alert` marks a genuine failure. Untagged
       * notes are session bookkeeping and stay out of the timeline.
       */
      note?: "config" | "alert";
      at: number;
    }
  | { id: string; kind: "thought"; text: string; at: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: ToolCallStatus | string;
      toolKind?: string;
      detail?: string;
      content?: AgentToolContent[];
      at: number;
    }
  | {
      id: string;
      kind: "plan";
      entries: { content: string; status: string }[];
      at: number;
    };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionPrompt {
  id: string;
  title: string;
  toolCallId?: string;
  /** Paths / locations from the tool call when available. */
  locations?: string[];
  kind?: string;
  options: PermissionOption[];
}
