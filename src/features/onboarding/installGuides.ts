export type HostOs = "windows" | "macos" | "linux" | string;

export interface InstallGuide {
  id: string;
  title: string;
  summary: string;
  required: boolean;
  /** Shown when the tool/agent is missing. */
  commands: { label: string; command: string }[];
  docsUrl?: string;
}

export function runtimeGuides(os: HostOs): InstallGuide[] {
  const windows = os === "windows";
  return [
    {
      id: "node",
      title: "Node.js ≥ 20",
      summary: "Required to launch ACP adapters (npx) and the offline fixture agent.",
      required: true,
      commands: windows
        ? [
            { label: "winget", command: "winget install OpenJS.NodeJS.LTS" },
            { label: "PowerShell", command: "irm https://nodejs.org/dist/index.json" },
          ]
        : [
            { label: "fnm / nvm", command: "nvm install 22 && nvm use 22" },
            { label: "apt (Ubuntu)", command: "sudo apt install -y nodejs npm" },
          ],
      docsUrl: "https://nodejs.org/",
    },
    {
      id: "git",
      title: "Git",
      summary: "Used for project workflows and upcoming checkpoint/review features.",
      required: true,
      commands: windows
        ? [{ label: "winget", command: "winget install Git.Git" }]
        : [
            { label: "apt", command: "sudo apt install -y git" },
            { label: "brew", command: "brew install git" },
          ],
      docsUrl: "https://git-scm.com/",
    },
  ];
}

export function agentGuides(os: HostOs): InstallGuide[] {
  const windows = os === "windows";
  return [
    {
      id: "codex-acp",
      title: "Codex CLI",
      summary: "OpenAI Codex harness. Best path for custom OpenAI-compatible providers.",
      required: false,
      commands: windows
        ? [
            { label: "npm", command: "npm install -g @openai/codex" },
            {
              label: "ACP adapter (on demand)",
              command: "npx -y @agentclientprotocol/codex-acp",
            },
          ]
        : [
            { label: "npm", command: "npm install -g @openai/codex" },
            {
              label: "ACP adapter (on demand)",
              command: "npx -y @agentclientprotocol/codex-acp",
            },
          ],
      docsUrl: "https://developers.openai.com/codex",
    },
    {
      id: "claude-acp",
      title: "Claude Code",
      summary: "Anthropic Claude Code. Prefer the official installer (npm install is deprecated).",
      required: false,
      commands: windows
        ? [
            {
              label: "PowerShell (official)",
              command: "irm https://claude.ai/install.ps1 | iex",
            },
            {
              label: "ACP adapter (on demand)",
              command: "npx -y @agentclientprotocol/claude-agent-acp",
            },
          ]
        : [
            {
              label: "curl (official)",
              command: "curl -fsSL https://claude.ai/install.sh | bash",
            },
            {
              label: "ACP adapter (on demand)",
              command: "npx -y @agentclientprotocol/claude-agent-acp",
            },
          ],
      docsUrl: "https://code.claude.com/docs",
    },
    {
      id: "pi-agent",
      title: "Pi Coding Agent",
      summary: "MIT agent toolkit. Optional third harness via npx / dedicated CLI.",
      required: false,
      commands: [
        {
          label: "npx",
          command: "npx -y @earendil-works/pi-coding-agent",
        },
      ],
    },
    {
      id: "fixture",
      title: "Fixture agent",
      summary: "Offline ACP peer bundled with Glyphra — needs Node only.",
      required: false,
      commands: [{ label: "bundled", command: "node fixtures/replay-agent.mjs" }],
    },
  ];
}
