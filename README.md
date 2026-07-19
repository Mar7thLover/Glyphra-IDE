# Glyphra

**Agent-first, feather-light code studio.**

Glyphra is an open-source (MIT) text editor / lightweight IDE built around one idea: in the age of coding agents, humans mostly **read, review, and steer** — they rarely type every line. So Glyphra drops the heavyweight IDE machinery (debuggers, extension platforms, task systems) and doubles down on:

- **Instant startup, tiny footprint** — Tauri 2 + system WebView, cold start ~1s, no Electron tax.
- **Agent-native workflow** — first-class integration with open agent harnesses (Codex CLI, Claude Code) over the Agent Client Protocol; subscription login *and* API keys (including any OpenAI-compatible endpoint) both work.
- **Review-centric UX** — every agent turn is checkpointed; accept or reject changes hunk by hunk.
- **Visual polish** — a clean, Cursor-inspired interface with fluid micro-animations, Mica on Windows 11, light/dark themes.

Glyphra 是一个 MIT 开源的「以 agent 为中心」的文本编辑器兼轻量 IDE:砍掉重型 IDE 设施,专注**阅读、审阅、驾驭 agent** 的工作流 —— 秒级冷启动、低常驻内存、订阅与 API Key 双认证、逐 hunk 变更审阅、以及经得起挑剔的视觉体验。

> **Status: pre-alpha (M0 in progress).** Nothing to install yet — watch the repo.

## Development

Prerequisites: [Rust](https://rustup.rs/) (stable), [Node.js](https://nodejs.org/) ≥ 20, [pnpm](https://pnpm.io/), git.

```sh
pnpm install
pnpm tauri dev
```

## License

[MIT](./LICENSE) — Glyphra itself and all bundled dependencies are MIT-compatible. Agent CLIs (Codex CLI, Claude Code, …) are **not bundled**; Glyphra detects and drives the ones you install.
