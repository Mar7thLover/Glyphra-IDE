export type AgentBackendKind = "codex-acp" | "claude-acp" | "pi-agent" | "custom-agent";

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
