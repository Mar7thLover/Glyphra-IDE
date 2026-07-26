# Glyphra — productization roadmap

> Living backlog for taking Glyphra from the completed M0–M2.5 foundation to
> a production-ready, agent-first desktop IDE. Long-form rationale remains in
> [development-plan.md](./development-plan.md) and
> [git-review-ux-plan.md](./git-review-ux-plan.md).
>
> Last reviewed: **2026-07-25**. Status reflects the current working tree, not
> only the last commit on `main`.

Labels: `[hardening]` stability/release · `[editor]` editing UX · `[agent]` agentic UX.

## Completed foundation

- [x] M0 — Tauri shell, CodeMirror 6 editor, theme, i18n, CI, `--smoke`
- [x] M1 — agent supervisor, ACP harnesses, providers/vault, onboarding, session archives
- [x] M2 — checkpoints, review/MergeEditor, PTY terminal, search, command palette
- [x] M2.5 — circuit breaker, byte-accurate checkpoints, IME checklist gate
- [x] Review R1–R2 — turn groups, keyboard adjudication, selection → Agent actions
- [x] Editor disk sync, search jump-to-line, Ctrl+P file index, ACP terminal capability
- [x] Tauri bundling, branded icons, NSIS/MSI/portable Windows artifacts
- [x] macOS ARM/Intel, Linux and Windows release matrix
- [x] Tag-driven GitHub Release workflow and Windows bundle verifier
- [x] First tagged prerelease: `v0.1.0-beta.1`
- [x] First stable release: `v0.2.0` (updater, Problems panel, MCP manager, keybindings, theme import, recovery)

## P0 — production safety and release blockers

### P0.1 Safety baseline

- [x] `[hardening]` Per-window React ErrorBoundary with reload and copy-diagnostics actions
- [x] `[hardening]` File-backed tracing plus synchronous `panic.log` for `panic=abort`
- [x] `[hardening]` Dirty-buffer snapshots, two-second autosave, hot-exit restore and conflict notice
- [x] `[hardening]` Remove plaintext vault writes; migrate legacy plaintext only after keyring succeeds
- [x] `[hardening]` Rust `kill_all`/`close_all` fallback for agent, command-runner, PTY and search resources
- [x] `[editor]` Status bar: line/column, selection count, indentation, UTF-8, EOL and language
- [x] `[editor]` Clickable LF/CRLF conversion
- [x] `[editor]` Image/audio/video preview plus safe generic-binary placeholder
- [x] `[agent]` `@file` references inline live unsaved content, with bounded disk fallback
- [x] `[agent]` Structured tool diff rendering and collapsible streamed thought cards

### P0.2 Remaining release gates

- [x] `[hardening]` Per-project windows (`proj-<hash>`) plus a dedicated welcome window
- [x] `[hardening]` Key Rust state by `(windowLabel, sessionId)` to prevent cross-window stream bleed
- [x] `[hardening]` Second launch with a path opens/focuses the matching project window
- [x] `[hardening]` In-app updater: `tauri-plugin-updater`, minisign keys, `latest.json`, install UX
- [ ] `[hardening]` Clean Win11 install and `v0.x → v0.x+1` update drill
- [x] `[hardening]` `THIRD-PARTY` rollup with `cargo-about` and a frontend license checker
- [x] `[hardening]` Full settings completeness pass
- [x] `[hardening]` Editable keybindings with persistence and `when` clauses
- [x] `[hardening]` Unify editor/agent preferences with Rust settings and cross-window sync
- [ ] `[hardening]` Manual fault drills: React render throw, Rust panic, forced recovery, orphan-process check

## P1 — core editor and agent workflows

### P1.1 Context and indexing `[agent]`

- [x] Repository-wide `@file`, `@folder` and bounded lightweight `@symbol` mentions
- [x] Reuse `fileIndexStore.rankFiles/fuzzyScore` as the composer data source
- [x] Discover `AGENTS.md`, `CLAUDE.md` and `.cursorrules` on project open
- [x] Rules status UI, one-click open/edit, and optional live-content injection

### P1.2 Conversation and review `[agent]`

- [x] Show checkpoint anchors in the chat timeline
- [x] “Restore to before this message” using newest-to-oldest checkpoint replay
- [x] Edit/resend user messages and retry failed assistant turns
- [x] Queue or redirect follow-ups while an agent is busy
- [x] Paste/drop bounded image input and honor advertised ACP vision capabilities
- [x] Apply validated ReviewCommentCard unified diff → checkpoint write → review queue
- [x] Inline CodeMirror hunk controls for undecided checkpoint changes
- [x] Controlled audited `git_commit` IPC and generated commit message after the queue clears

### P1.3 Harness and extension UX `[agent]`

- [x] Surface harness-native slash commands such as `/compact` and `/init`
- [x] Token and cost accumulation per conversation
- [x] MCP settings UI with add/edit/remove/enable/disable operations

### P1.4 Lightweight editor improvements `[editor]`

- [x] Completion sources: current buffers, paths, snippets and language keywords
- [x] Diagnostics store, editor gutter and Problems panel
- [x] Build/terminal/agent diagnostic ingestion
- [x] Trim trailing whitespace, final newline and optional format-on-save

## P2 — multi-session and platform maturity

- [x] `[agent]` Multiple/background conversations without stopping the active one
- [x] `[editor]` Split/grid editors, tab drag reorder and preview tabs
- [x] `[editor]` `Ctrl+Shift+O` symbol navigation
- [x] `[editor]` Encoding detection/selection and non-UTF-8 conversion
- [x] `[hardening]` Opt-in diagnostic bundle and user-visible crash-report location
- [x] `[hardening]` Move synchronous checkpoint Git work to `spawn_blocking`
- [x] `[hardening]` Expand fixture coverage for recovery, review keyboard flows and session edges
- [x] `[hardening]` macOS/Linux native-feel pass
- [x] `[editor]` Optional xterm WebGL renderer with DOM fallback on context loss

## P3 — post-release roadmap

- [ ] `[editor]` Lazy-started LSP: completion, hover, navigation, references, rename, diagnostics
- [x] `[editor]` VS Code theme JSON import
- [x] `[editor]` Minimap, breadcrumbs, sticky scroll, bracket colors and indent guides
- [x] `[editor]` Full EditorConfig support
- [x] `[agent]` Ctrl+K inline edit and ghost-text completion
- [ ] `[agent]` One-click apply diff from chat through checkpoints/review
- [ ] `[agent]` Git-worktree multi-agent board
- [ ] `[hardening]` End-to-end/component test layer and systematic accessibility pass
- [ ] `[hardening]` SignPath Foundation code signing

## Verification gates

For every implementation batch:

```powershell
pnpm typecheck
pnpm test
pnpm exec vite build
pnpm check:size
pnpm check:bindings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Release-related work also runs:

```powershell
pnpm check:version
pnpm release:windows
.\src-tauri\target\debug\glyphra.exe --smoke
```

Any editor decoration change must pass [ime-checklist.md](./ime-checklist.md).
Agent protocol changes must pass `pnpm fixture:agent` plus a live smoke test
against at least two supported harnesses.
