<div align="center">

<img src="src-tauri/icons/icon.png" width="96" height="96" alt="Glyphra icon" />

# Glyphra

**The editor built for a world where agents write the code and you steer it.**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[Features](#why-glyphra) · [Quick start](#quick-start) · [Architecture](#architecture) · [Docs](#documentation) · [Roadmap](#status--roadmap)

<br />

![release](https://img.shields.io/badge/release-v0.2.0-6366f1?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![stack](https://img.shields.io/badge/Tauri_2-React_19-0f172a?style=flat-square)
![platforms](https://img.shields.io/badge/Windows_·_macOS_·_Linux-CI-green?style=flat-square)

</div>

---

Most IDEs were designed for a human typing every line. Glyphra is designed for the workflow that actually happens now: you delegate a task to a coding agent, watch it plan and edit in real time, and spend your attention **reviewing and steering** rather than typing.

Debuggers, extension marketplaces, and task runners are legacy weight from the pre-agent era — Glyphra leaves them out on purpose. What remains is a feather-light Tauri app: CodeMirror 6, an ACP-normalized agent timeline, and git-checkpointed review as the primary interaction.

> **Status: `0.2.0` — first stable release.** Signed in-app updates, checkpointed review, and the full editor surface are in place and meant for daily use. Being `0.x`, settings and the harness contract can still change between minor versions; app binaries are not yet code-signed. Installers: [GitHub Releases](https://github.com/Mar7thLover/Glyphra-IDE/releases) · changelog: [`CHANGELOG.md`](./CHANGELOG.md) · release guide: [`docs/releasing.md`](./docs/releasing.md).

## Why Glyphra

| Pillar | What you get |
| --- | --- |
| **Agent-native** | Codex, Claude Code, Pi, and OpenCode are auto-detected on `PATH` and driven through their own native protocols — no shim CLI, no lowest-common-denominator prompt format. Custom ACP / JSONL / shell / HTTP harnesses plug into the same UI. |
| **Review-first** | Every agent turn is checkpointed against a shadow git repo. Diffs render hunk-by-hunk with byte-accurate reconstruction; accept or reject the way you would review a PR. |
| **Live control** | Model, reasoning effort, Fast mode, and permission level (request approval / auto-approve / full access) can change mid-session without tearing down the native thread. |
| **Provider usage** | Subscription and API-key usage — context window, rate-limit windows, credits — normalized into one snapshot per provider in the composer. |
| **Actually light** | Tauri 2 + the OS WebView, not Electron. Cold start around a second, low idle memory, Mica/Acrylic on Windows 11, CodeMirror 6 instead of a bundled Monaco. |

## What's inside

| Area | Details |
| --- | --- |
| **Harness catalog** | Reads each CLI's native model list, reasoning options, context window, and permission profile at startup so the composer reflects what is actually installed. |
| **ACP-normalized sessions** | Codex JSON-RPC, Claude stream-json, Pi JSON events, OpenCode ACP, plus custom stdio/JSONL/shell and OpenAI/Anthropic HTTP — all bridged into one timeline ([contract](./docs/harness-api.md)). |
| **Checkpointed review** | Per-turn shadow snapshots; review panel with turn groups, working-tree diffs, keyboard adjudication (`j/k`, `a/r`), and turn-level restore. |
| **Session archives** | Local JSONL archives with list / load / delete; live restore prefers native `session/resume` → `session/load`, then continuation context. |
| **Editor core** | CodeMirror 6, language auto-detection, VS Code-familiar keymap, unsaved-changes guarding, command palette, ripgrep search, PTY terminal. |
| **Inline editing** | `Ctrl+K` rewrites the selection in place through a hidden, tool-free agent session — accept with `Enter`, discard with `Esc`. Opt-in ghost-text completion uses the same session. |
| **Editor comfort** | Minimap, breadcrumbs, sticky scroll, indent guides, bracket colors, `Ctrl+Shift+O` symbol jump, encoding detection, EditorConfig, format-on-save, and VS Code theme JSON import. |
| **Problems panel** | A diagnostics store fed by builds, terminal output, and agent turns, surfaced in the gutter and a dedicated panel. |
| **MCP manager** | Add, edit, enable, and disable MCP servers from Settings — no hand-edited JSON. |
| **Updates** | `tauri-plugin-updater` with minisign-signed manifests and an in-app update banner; installers stay unsigned for now. |
| **Resilience** | Per-window error boundary, file-backed tracing plus `panic.log`, dirty-buffer autosave with hot-exit restore, and an opt-in diagnostic bundle. |
| **Onboarding** | First-run detect for git / Node / agent CLIs with winget · irm · npm install guides. |

## Quick start

**Prerequisites:** [Rust](https://rustup.rs/) (stable ≥ ~1.85), [Node.js](https://nodejs.org/) ≥ 20, [pnpm](https://pnpm.io/), git. Agent CLIs (Codex, Claude Code, …) are **not bundled** — install the ones you use; Glyphra discovers them on `PATH`.

```sh
pnpm install
pnpm tauri dev
```

Useful scripts:

```sh
pnpm test              # vitest
pnpm typecheck         # tsc --noEmit
pnpm check:bindings    # generated IPC types vs src-tauri
pnpm check:size        # frontend bundle budget
pnpm check:version     # package / tauri / cargo version sync
pnpm licenses:check    # dependency license policy + THIRD-PARTY.md freshness
pnpm tauri build       # platform installers (see docs/releasing.md)
pnpm release:windows   # NSIS + MSI + portable exe, then verify artifacts
```

Frontend-only Vite preview (no Rust IPC): `pnpm dev` on port `1420`. Backend self-check (no GUI): after a debug build, `./src-tauri/target/debug/glyphra --smoke` prints a JSON status line and exits.

## Releases

Tagged `v*` pushes run [`.github/workflows/release.yml`](./.github/workflows/release.yml) and publish installers for Windows (NSIS + MSI + portable exe), macOS (arm64 + x64 DMG), and Linux (AppImage / deb / rpm). The Windows installer registers Explorer's **Open Folder with Glyphra** action and `.glyphra-workspace` files. Details: [docs/releasing.md](./docs/releasing.md).

## Architecture

```
┌─ Glyphra (Tauri 2) ─────────────────────────────────────────┐
│  React 19 · Zustand · CodeMirror 6 · streamdown · xterm     │
│    Agent panel · Review center · Editor · Search · Terminal │
│    lib/acp AgentBus  ←── typed IPC (ts-rs) ──→  Rust core   │
│  agent/ · gitx/ · pty · search · vault · providers          │
└─────────────────────────────────────────────────────────────┘
        │ native CLI / custom harness (stdio · HTTP)
        ▼
  Codex · Claude Code · Pi · OpenCode · your adapter
```

- **Frontend** owns ACP session semantics; **Rust** owns process supervision, framing, checkpoints, PTY, search, and the OS keyring.
- Every harness is bridged into one ACP-shaped event stream (`message.delta`, `plan`, `tool.*`, `done`, `error`) — the only shape the UI needs to understand.
- IPC types are generated with `ts-rs`; `pnpm check:bindings` fails CI on drift.

## Documentation

| Doc | Purpose |
| --- | --- |
| [docs/README.md](./docs/README.md) | Documentation index |
| [docs/TODO.md](./docs/TODO.md) | Near-term execution backlog |
| [docs/releasing.md](./docs/releasing.md) | Tagged release / packaging guide |
| [docs/release-drills.md](./docs/release-drills.md) | Clean-install, update, and fault drills before promoting a build |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes per version |
| [docs/development-plan.md](./docs/development-plan.md) | Full product plan & milestones (zh) |
| [docs/harness-api.md](./docs/harness-api.md) | Custom harness / provider contract |
| [docs/git-review-ux-plan.md](./docs/git-review-ux-plan.md) | Review-center UX blueprint |
| [docs/ime-checklist.md](./docs/ime-checklist.md) | CJK IME hand-test gate for editor changes |
| [AGENTS.md](./AGENTS.md) | Cursor Cloud / agent contributor notes |

## Status & roadmap

| Milestone | Focus | State |
| --- | --- | --- |
| **M0** | Shell, editor, theme, CI, smoke | Done |
| **M1** | Agent core, providers, onboarding, archives | Done |
| **M2** | Checkpoints, review, terminal, search, palette | Done |
| **M2.5** | Circuit breaker, byte-accurate ckpts, IME gate | Done |
| **M3** | Multi-window, NSIS / portable, updater, release | Done |
| **Review R2–R3** | Selection → agent, inline review, commit assist | Done |
| **v0.2** | Problems panel, MCP manager, keybindings, theme import, recovery | Done |

Next up: lazy-started LSP (completion, hover, navigation, rename), one-click apply diff from chat, git-worktree multi-agent board, an end-to-end test layer with an accessibility pass, Gemini CLI, a native Rust Codex app-server client (drop Node), and SignPath code signing.

See [docs/TODO.md](./docs/TODO.md) for the ordered near-term backlog.

## License

[MIT](./LICENSE) — Glyphra and its bundled dependencies are MIT-compatible. Agent CLIs are **not** shipped; Glyphra detects and drives the ones you install.

Custom integration contract: [docs/harness-api.md](./docs/harness-api.md).
