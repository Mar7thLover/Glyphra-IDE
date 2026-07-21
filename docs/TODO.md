# Glyphra — near-term TODO

> Living backlog after M0–M2.5. Prefer this file for **what to do next**; keep
> long-form rationale in [development-plan.md](./development-plan.md) and
> [git-review-ux-plan.md](./git-review-ux-plan.md).
>
> Last reviewed: **2026-07-21** (synced with `main` @ docs refresh).

## Done (do not re-open unless regressing)

- [x] M0 — shell, CM6 editor, theme, i18n skeleton, CI, `--smoke`
- [x] M1 — agent supervisor, Codex / Claude / custom harnesses, providers + vault, onboarding, session archives
- [x] M2 — shadow checkpoints, review panel + MergeEditor, PTY terminal, ripgrep search, command palette
- [x] M2.5 — circuit breaker, byte-accurate checkpoints, IME checklist gate
- [x] Agent workspace polish — harness catalog, provider usage snapshots, session restore path
- [x] Review R1 (core) — turn groups, `+/-` badges, keyboard adjudication, working-tree group

---

## P0 — ship a usable release track (M3 core)

Ordered for dependency: packaging is blocked on multi-window only where process routing must be window-scoped; otherwise work can parallelize.

### P0.1 Multi-window & process routing

- [ ] Per-project window (`proj-<hash>` label) + welcome window
- [ ] Rust `AppState` keyed by `(windowLabel, sessionId)` — no cross-window stream bleed
- [ ] CloseRequested → confirm running turn → cascade kill (Job Object / equivalent)
- [ ] `single-instance`: second launch with path opens a new project window in the existing process

### P0.2 Packaging

- [ ] Enable Tauri bundling (`bundle.active`) with branded icons
- [ ] NSIS installer (Windows) under size budget; portable exe as extra artifact
- [ ] macOS / Linux package targets wired in CI matrix
- [ ] `THIRD-PARTY` license rollup (`cargo-about` + frontend license-checker)

### P0.3 Updater & release pipeline

- [ ] minisign keypair (secret + offline backup); `latest.json` channel
- [ ] In-app update check / install path
- [ ] `.github/workflows/release.yml`: tag → three-platform build → draft GitHub Release
- [ ] Clean Win11 VM install → update drill (v0.x → v0.x+1)

### P0.4 Release UX polish

- [ ] Keybinding cheatsheet + minimal remapping surface
- [ ] Settings page completeness pass (personal / models / editor / agent / about)
- [ ] Motion polish with `prefers-reduced-motion` already respected
- [ ] Tighten smoke budgets toward plan exit criteria (interactive TTI / RSS where measurable)

---

## P1 — review becomes the primary workflow (R2–R3)

Tracks [git-review-ux-plan.md](./git-review-ux-plan.md). R1 is largely done.

### P1.1 Selection → Agent (R2)

- [x] Floating `✦ Agent` capsule on editor selection + `Ctrl+L`
- [x] Actions: review / explain / rewrite / add tests
- [x] Composer reference chips (`@file:12-40`) mapped to ACP resource blocks
- [x] `ReviewCommentCard` parser (severity markdown) with jump-to-line highlight

### P1.2 Inline review & commit assist (R3)

- [ ] Gutter side-bar for undecided hunks (agent vs manual colors)
- [ ] Inline glass card: mini diff + accept/reject + “ask Agent”
- [ ] Apply suggested diff from ReviewCommentCard → `ckpt_write_file` + review queue
- [x] Status-bar branch + ahead/behind
- [ ] Controlled `git_commit` IPC + “generate commit message” after queue cleared

---

## P2 — quality & platform

- [ ] Optional `@xterm/addon-webgl` with DOM fallback on context loss
- [ ] Keep [ime-checklist.md](./ime-checklist.md) as merge gate on editor / decoration PRs
- [ ] Expand fixture coverage for review keyboard flows and session restore edges
- [ ] macOS / Linux native feel pass (beyond CI green)
- [x] Editor disk sync for clean open tabs after FS / agent writes
- [x] Search hit jump-to-line
- [x] Ctrl+P fuzzy go-to-file (git ls-files index)
- [x] ACP `terminal` client capability over pipe-backed command runner

---

## P3 — post-v1 roadmap (do not start until M3 ships)

- Basic LSP (hover / go-to / diagnostics), lazy-started
- VS Code theme JSON → CSS variables + CM6 highlight
- Gemini CLI / additional ACP backends
- Native Codex `app-server` Rust client (drop Node for that path)
- Git worktree multi-agent board
- MCP manager UI
- SignPath Foundation code signing (v0.x stays unsigned; document SmartScreen bypass)

---

## How to pick work

1. Prefer **P0** items that unblock a downloadable build over polish.
2. **P1** may interleave with P0 when it does not block packaging (e.g. selection capsule is frontend-only).
3. Do not start **P3** until a tagged pre-release exists.
4. Any editor decoration change must pass the IME checklist before merge.
