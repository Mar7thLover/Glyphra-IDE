# Glyphra

**The editor built for a world where agents write the code and you steer it.**

Most IDEs were designed for a human typing every line. Glyphra is designed for the workflow that actually happens now: you delegate a task to a coding agent, watch it plan and edit in real time, and spend your attention reviewing and steering rather than typing. Everything else — debuggers, extension marketplaces, task runners — is legacy weight from the pre-agent era, and Glyphra leaves it out on purpose.

大多数 IDE 是为"人逐行敲代码"设计的。Glyphra 面向的是现在真实发生的工作流:你把任务交给 agent,实时看它规划、编辑,把注意力放在审阅与驾驭上,而不是打字。调试器、插件市场、任务系统这些前 agent 时代的重型设施,Glyphra 有意地不做。

> **Status: pre-alpha.** APIs and UI are still moving fast — expect breaking changes between commits.

## Why Glyphra

- **Agent-native, not agent-bolted-on.** Codex, Claude Code, Pi, and OpenCode are auto-detected on `PATH` and driven through their own native protocols — no shim CLI, no lowest-common-denominator prompt format. Every session, regardless of transport, is normalized into one ACP-shaped timeline in the frontend, so the UI you use for Codex is the same UI you use for a custom HTTP harness.
- **Review is the primary interaction, not an afterthought.** Every agent turn is checkpointed against git. Diffs render hunk-by-hunk with byte-accurate reconstruction, and you accept or reject changes the way you'd review a PR — because that's functionally what you're doing, dozens of times a session.
- **Live control over a running agent.** Model, reasoning effort, and permission mode (request approval / auto-approve / full access) can change mid-session without tearing down the native thread — Glyphra forwards the change as a live config update (`session/set_config_option`, `turn/start` overrides) instead of restarting the conversation.
- **Provider usage where you need it.** Subscription and API-key usage — context window consumed, rate-limit windows, credit balances — is normalized into one snapshot per provider, whether it comes from a CLI's own usage command or an API's rate-limit headers.
- **Actually lightweight.** Tauri 2 + the OS WebView, not Electron. Cold start in about a second, low idle memory, Mica/Acrylic on Windows 11, and a CodeMirror 6 editor core instead of a bundled Monaco.

## What's inside

| Area | What it does |
| --- | --- |
| **Harness catalog** | Reads each native CLI's own model list, reasoning-effort options, context window, and permission profile at startup, so the composer reflects what the installed agent actually supports instead of a hardcoded list. |
| **ACP-normalized sessions** | Codex JSON-RPC, Claude's stream-json, Pi's JSON events, and raw ACP all get bridged into one timeline format ([contract documented in `docs/harness-api.md`](./docs/harness-api.md)) — including custom stdio/JSONL/shell and OpenAI/Anthropic HTTP harnesses you configure yourself. |
| **Checkpointed review** | Every turn snapshots the workspace through git; the review panel diffs hunk-by-hunk with byte-accurate reconstruction, so partial accepts never corrupt a file. |
| **Provider usage snapshots** | A Rust↔Node bridge (`scripts/harness-bridge.mjs`) queries each CLI's native usage/rate-limit endpoint and normalizes it into one `ProviderUsageSnapshot` shape shown in the composer. |
| **Editor core** | CodeMirror 6 with language auto-detection, VS Code-familiar keymap, unsaved-changes guarding, and a command palette — fast and small rather than feature-maximal. |
| **Native platform feel** | Mica on Windows 11, light/dark themes, a real app menu bar, and PTY-backed terminal sessions per project. |

## Development

Prerequisites: [Rust](https://rustup.rs/) (stable), [Node.js](https://nodejs.org/) ≥ 20, [pnpm](https://pnpm.io/), git.

```sh
pnpm install
pnpm tauri dev
```

Other useful scripts:

```sh
pnpm test              # vitest
pnpm typecheck         # tsc --noEmit
pnpm check:bindings    # verify generated IPC types match src-tauri
pnpm check:size        # bundle size budget
```

## Architecture at a glance

- **Frontend:** React 19 + Zustand stores + CodeMirror 6, built with Vite. IPC bindings are generated from Rust types (`ts-rs`) so the TypeScript side stays in sync with the Tauri backend by construction.
- **Backend:** Rust/Tauri 2. `agent/` owns harness detection, the native catalog, and process supervision; `gitx/` owns checkpoint diffing and the git CLI wrapper; `ipc/` exposes typed commands to the frontend.
- **Transport:** every harness — native or custom — is bridged into one ACP-shaped event stream (`message.delta`, `plan`, `tool.start`/`tool.end`, `done`, `error`), which is the only shape the frontend needs to understand.

## License

[MIT](./LICENSE) — Glyphra itself and all bundled dependencies are MIT-compatible. Agent CLIs (Codex CLI, Claude Code, …) are **not bundled**; Glyphra detects and drives the ones you install.

Custom integration contract: [docs/harness-api.md](./docs/harness-api.md).
