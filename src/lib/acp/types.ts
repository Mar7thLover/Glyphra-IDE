export type AgentBackendKind = "codex-acp" | "claude-acp" | "pi-agent" | "custom-agent";

export type StartableBackend = AgentBackendKind | "fixture";

export type CustomAgentProtocol = "acp" | "stdio-jsonl" | "shell-command";

export interface CustomAgentHarness {
  id: string;
  name: string;
  command: string;
  args: string[];
  protocol: CustomAgentProtocol;
  env: Record<string, string>;
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

export type AgentTimelineItem =
  | { id: string; kind: "user"; text: string; at: number }
  | { id: string; kind: "assistant"; text: string; at: number }
  | { id: string; kind: "system"; text: string; at: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: ToolCallStatus | string;
      toolKind?: string;
      detail?: string;
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
  options: PermissionOption[];
}
