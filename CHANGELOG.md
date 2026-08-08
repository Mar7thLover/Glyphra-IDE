# Changelog

All notable changes to Glyphra are documented here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/) with pre-release tags for test builds.

## [Unreleased]

VSCode-style multi-root workspaces, better search, and single-file editing.

### Added

- **Multi-root workspaces** — `File → Add Folder to Workspace…` (and the
  command palette) appends folders to the current window. The explorer shows
  one tree per root with a root-header menu to remove a folder; Ctrl+P, symbols,
  rules, composer `@`-mentions and search span every root. A
  `.glyphra-workspace` descriptor with multiple `folders` opens them all, with
  the first folder as the primary root that agent sessions, checkpoints, git
  and recovery key off.
- **Search options** — case-sensitive, whole-word and explicit regex toggles
  (no more silent literal→regex fallback), plus include/exclude file globs.
  Matching highlights use the exact byte ranges from the backend, so
  case-insensitive and regex results highlight correctly.
- **Cross-file Replace All** — the search panel gains a replace bar; files are
  rewritten encoding-preservingly (UTF-8/16 with BOM round-trips), regex
  replacements support `$0`–`$9` group expansion, and open tabs refresh from
  disk afterwards. Replacement is one-shot: confirm before you click.
- **Untitled buffers** — `Ctrl+N` (`File → New File`) opens an unsaved buffer;
  the first save asks for a destination. Recovery keeps untitled content with
  its `Untitled-N` label.
- **Drag and drop** — dropping files opens them as loose tabs; dropping one or
  several folders opens them as a workspace (or adds them to the current one).
- **Loose-file sidebar** — with no project open, the activity rail and sidebar
  stay visible so "Open Folder" is always reachable next to open files.
- **OpenCode detection on Windows** — PATH probing prefers `.exe/.cmd/.bat`
  launchers over the bare npm POSIX shim, so npm-global installs of `opencode`
  (and other CLIs) are recognized and spawnable again.

### Fixed

- **Pasting could visually collapse the document into mega-lines and wipe the
  undo history.** Buffers were mounted with a per-document CodeMirror
  `lineSeparator` matching the file's endings, but CodeMirror splits inserted
  text on that exact separator only: pasting LF text into a CRLF file (or CRLF
  clipboard content into an LF file — the Windows default) left literal
  `\r`/`\n` characters inside lines, flipped the detected line ending, and
  remounted the whole editor with the other separator — at which point every
  original line break stopped being one. Buffers are now always LF-normalized
  in memory; the real line ending is tracked per tab and applied only when
  writing to disk. Paste, EOL switching (now instant metadata, no buffer
  rewrite), mixed-ending files and undo history all behave.
- **Saving could silently lose the last ~140ms of typing.** The editor
  debounces its store sync; menu/keyboard-driven saves, close flows, recovery
  snapshots and exit all read the store without flushing that debounce. Every
  consumer now flushes mounted editors synchronously before reading buffers.
- **Save could fail spuriously with "file changed on disk".** Two saves racing
  (held-down Ctrl+S, double-clicked save button, close-dialog save) both
  carried the same expected disk hash; the loser's write tripped the
  optimistic lock. Saves are serialized per file.
- **A real save conflict was a dead end.** The optimistic-lock failure now
  shows a banner with "Overwrite disk version" and "Reload from disk" instead
  of an undismissable error; generic editor errors gained a dismiss button.
- **Switching tabs or opening a file no longer interrogates you about unsaved
  changes.** Dirty buffers simply stay alive across navigation, like every
  other editor. The save/discard/cancel dialog now appears only where a buffer
  is actually about to be destroyed: closing a tab, reopening with a different
  encoding, or leaving loose-file mode.
- **Exiting and switching projects could destroy unsaved work.** The close
  flow relied on `window.confirm` (a no-op in some webviews — the window
  could refuse to close, or close losing edits), and switching projects wiped
  tabs first and then wrote a "nothing dirty" recovery snapshot over the one
  that held the edits. Exit and project switches now flush editors, hot-stash
  dirty buffers into the recovery snapshot when a project is open, and walk
  per-file save dialogs in loose-file mode; the stale cleanup that deleted the
  just-written snapshot is gone. A failed launch request no longer wedges the
  queue for every later "open with Glyphra".
- **Files with a few invalid bytes refused to open at all.** Decode errors now
  degrade to a lossy, read-only view (invalid sequences shown as `�`) with a
  banner pointing at "Reopen with encoding" — instead of an opaque error. The
  search-replace path skips lossy files so it can never destroy original bytes.
- **Saves are atomic.** Writes go to a temp file that is flushed and renamed
  over the target, so a crash mid-save leaves the old or the new file — never
  a truncated hybrid. Truncated big-file reads also stopped materializing the
  whole file in memory first.
- Save-time trimming/formatting and external disk syncs no longer yank the
  cursor to the top of the file: the editor applies the minimal changed span
  instead of replacing the whole document.
- The modified-code gutter re-diffed the entire document against the saved
  baseline on every keystroke (with a 20ms diff budget on the UI thread).
  Markers now map through edits while typing and rebuild once, shortly after
  the burst ends.
- `Ctrl+N` untitled numbering no longer collides with untitled buffers
  restored from recovery, and two racing opens of the same file no longer
  create duplicate tabs.
- Accepting inline-review hunks in a CRLF file no longer rewrites the whole
  file with LF endings.
- **Opening a folder could exhaust system memory and take the machine down.**
  Loading a workspace refreshed the review queue, which ran one
  `git_diff_file` per working-tree entry through `Promise.all` — no concurrency
  limit. A freshly opened folder routinely reports thousands of untracked
  files, and each of those calls spawned `git show`, `git diff` *and* a full
  `git status --untracked-files=all` over the whole repository, then returned
  both revisions of the file in full over IPC. Thousands of git processes
  started at once, each holding its own copy of the tree. The fan-out is now
  bounded on every axis: at most 6 diffs in flight, 100 diffed eagerly (the
  rest hydrate on selection), 2000 working-tree entries tracked, and
  `git_diff_file` asks git for the status of the single path it is diffing
  instead of the entire repository.
- Git and review state were refreshed twice concurrently on every folder open —
  once from the project store and once from the App project-change effect. Only
  the effect does it now.
- Git subprocess output is capped at 8 MiB per call (line-aligned), with the
  child killed at the cap. `git status --untracked-files=all` and
  `git ls-files -co` are proportional to the size of the tree, so opening a
  large unignored folder used to materialize the whole listing in Rust,
  serialize it over IPC and parse it again in the webview. Status listings are
  additionally capped at 5000 entries and diff text at 4 MiB per side.
- Opening a subdirectory of a repository scanned and reported the *entire*
  repository: porcelain paths are repository-root relative, so nothing resolved
  against the opened folder and every explorer badge was wrong. The scan is now
  limited to the opened subtree and rebased onto it, and HEAD lookups use
  `HEAD:./path` so a tracked file under a subdirectory root is no longer
  mistaken for a new one.
- The file watcher registered up to 8000 directories synchronously on the IPC
  thread — on Windows that is a 16 KiB buffer plus two kernel handles each
  (~128 MiB and 16 000 handles per workspace root) and one `read_dir` per
  directory, freezing the UI for the duration. Registration and teardown now
  run on the blocking pool, and the cap is 2048 directories (breadth-first, so
  the levels the explorer shows are the ones that get watched).
- The Ctrl+P index cap was per root rather than global, and folder derivation
  from it was unbounded — every path prefix became its own string, several
  times the size of the index it came from, built on the main thread while the
  workspace loaded.
- **Search could exhaust system memory.** Result lines were sent whole, with one
  highlight range per match on the line and one DOM node per range — a single
  minified line (routine in `dist/` or `node_modules/`) was megabytes of text and
  hundreds of thousands of highlights, tens of gigabytes once rendered. Lines are
  now windowed to 1000 characters around the first match with at most 100
  highlights, files over 4 MiB are skipped, and `node_modules`, `dist`, `target`,
  `.vite` and `.git` are pruned from the walk.
- Search now honours `.gitignore` in workspace roots that are not git
  repositories — dropping a plain folder onto the window or adding it to a
  workspace used to search every ignored build artifact in it.
- Search highlights were offset on indented and non-ASCII lines: ranges are byte
  offsets rebased onto the trimmed preview as UTF-16 offsets, which is what the
  panel indexes by.
- Typing in the search box leaked a full workspace walk per keystroke: a
  superseded search whose id arrived late was never cancelled, and its results
  were merged into the newer search's list.
- A workspace root named `dist`, `target` or `node_modules` was pruned along
  with the dependency trees, making search silently return nothing; pruning now
  skips the root itself.
- Inline review control used a stale `var(--raised)` token (invisible
  background); now `var(--bg-raised)`.
- Hard-coded status colors replaced with `--warn` and `--diff-*` design tokens
  across the status bar, problems panel, review badges and comment cards;
  the merge-accept control follows the monochrome design; the title-bar close
  hover uses `--danger`.

## [0.3.0] — 2026-07-26

Language servers, parallel worktrees, and a monochrome tone system.

### Added

- **Lazy language servers** — one process per `(window, workspace, language)`,
  started only after a matching file is opened and retired once its last
  document closes. Covers completion, hover, go to definition (`F12`), find
  references (`Shift+F12`), rename (`F2`), and published diagnostics for Rust,
  TypeScript/JavaScript, Python, Go, C/C++, Java, JSON, HTML, CSS, YAML and Lua.
  No server is bundled; missing executables surface the install hint in the
  editor and in **Settings → Editor**, where servers can be toggled globally or
  per language.
- Rename lands as unsaved buffers across every touched file rather than writing
  to disk, so the change goes through the usual review-and-save path.
- `diagnostics_resource_counts` now reports live language servers, and window
  close cascades into shutting them down.
- **One-click apply for chat patches** — a multi-file unified diff in an
  assistant message applies as a single checkpoint turn and lands in the review
  queue as one change instead of one per file. Every file is resolved in memory
  first, so a hunk that no longer matches aborts before anything is written.
  Patch blocks are now recognised by their content rather than the fence label,
  and `--- /dev/null` entries create new files.

- **Git-worktree board** in the review panel — create, open and remove parallel
  checkouts of the current repository. Each worktree opens as its own project
  window, which gives it an independent agent session, terminal and checkpoint
  history. Worktrees are created under Glyphra's app data directory rather than
  inside the repository, and the primary checkout can never be removed.

- **Discoverability for the new surfaces** — go to definition, find references
  and rename symbol are in the command palette with their shortcuts, alongside a
  tone cycler; the status bar shows which language server is serving the active
  file and links to its settings.
- **Tonal theme variants** — **Neutral**, **Soft** and **Contrast**, layered on
  top of light/dark in **Settings → Personal**. All three are achromatic by
  design: they redistribute the gray ramp and never introduce a hue. Contrast
  additionally opts out of the translucent Mica backdrop, because a shell over
  an arbitrary wallpaper cannot promise a contrast ratio. The choice is applied
  before first paint and synchronizes across windows. Contrast also swaps the
  chromatic syntax palette for a monochrome one that differentiates by weight
  and slant — every ink in it clears WCAG AAA, asserted in the test suite.

### Fixed

- **Editor tabs are keyboard-reachable.** The close control was a `<span>` click
  handler nested inside the tab `<button>`, which no keyboard could reach. The
  strip is now a `tablist` with roving focus and a real close button per tab.
- Permission prompts, the command palette, and onboarding expose dialog
  semantics, and the agent error dismissals have accessible names. A static
  accessibility suite keeps all four checks from regressing.
- An LSP rename reached the store but not a mounted CodeMirror view, because the
  view only pulls text in when the on-disk `hash` changes — which an in-memory
  edit must not touch. External rewrites now carry their own revision counter.
- Two defects in the language-server client, which had been sitting outside the
  module tree and had therefore never been compiled: `parse_completion_items`
  moved a value while a borrow of it was live, and canonicalized paths kept
  Windows' `\\?\` prefix while URIs decoded to the plain form, so the workspace
  containment check silently discarded every published diagnostic.

### Known limitations

- Application binaries remain **unsigned**; in-app updates are minisign-signed.
- The editor decoration changes still owe a pass of `docs/ime-checklist.md`.
- No end-to-end component test layer.

## [0.2.0] — 2026-07-25

First stable release. Everything below landed on top of the `0.1.0-beta.1` test
build.

### Added

- **In-app updater** — `tauri-plugin-updater` with minisign-signed `latest.json`,
  an update banner, and a rolling `updater` release channel that also serves
  prereleases.
- **Problems panel** — diagnostics store fed by builds, terminal output, and
  agent turns, surfaced in the editor gutter and a dedicated panel.
- **MCP manager** — add, edit, remove, enable, and disable MCP servers from
  Settings.
- **Editable keybindings** with persistence and `when` clauses.
- **Editor comfort pass** — minimap, breadcrumbs, sticky scroll, indent guides,
  bracket colors, `Ctrl+Shift+O` symbol navigation, completion sources (buffers,
  paths, snippets, keywords), and image/audio/video preview.
- **VS Code theme JSON import** and full EditorConfig support.
- **Encoding detection and conversion** for non-UTF-8 files, plus clickable
  LF/CRLF switching and a richer status bar (line/column, selection, indent,
  encoding, EOL, language).
- **Save hygiene** — trim trailing whitespace, final newline, optional
  format-on-save.
- **`Ctrl+K` inline edit** and opt-in ghost-text completion through a hidden,
  tool-free agent session.
- **Per-project windows** (`proj-<hash>`) with a dedicated welcome window; Rust
  state is keyed by `(windowLabel, sessionId)` so streams cannot bleed across
  windows, and a second launch with a path focuses the matching window.
- **Conversation and review** — checkpoint anchors in the timeline, "restore to
  before this message", edit/resend and retry, queued follow-ups while an agent
  is busy, bounded image input honoring ACP vision capabilities, inline
  CodeMirror hunk controls, and an audited `git_commit` IPC with a generated
  commit message.
- **Context mentions** — repository-wide `@file`, `@folder`, and bounded
  `@symbol`, plus discovery of `AGENTS.md`, `CLAUDE.md`, and `.cursorrules`.
- **Harness-native slash commands** (`/compact`, `/init`) and per-conversation
  token/cost accumulation.
- **Background conversations**, split/grid editors, tab drag reorder, and
  preview tabs.
- **Resilience** — per-window React ErrorBoundary with reload and
  copy-diagnostics, file-backed tracing plus a synchronous `panic.log`,
  dirty-buffer autosave with hot-exit restore and conflict notice, and an opt-in
  diagnostic bundle with a user-visible crash-report location.
- **`THIRD-PARTY.md`** dependency rollup generated by `cargo-about` and a
  frontend license checker (`pnpm licenses:check`), bundled into each installer.
- Optional xterm WebGL renderer with DOM fallback on context loss.

### Changed

- Vault no longer writes plaintext; legacy plaintext is migrated only after the
  OS keyring succeeds.
- Checkpoint Git work moved to `spawn_blocking`.
- Editor and agent preferences are unified with Rust settings and synced across
  windows.
- macOS/Linux native-feel pass.
- `pnpm check:version` now also validates the WiX version for stable releases,
  not just prereleases.
- `pnpm release:windows` runs through `scripts/release-windows.ps1`.

### Fixed

- Rust `kill_all`/`close_all` fallback for agent, command-runner, PTY, and
  search resources prevents orphaned processes.

### Known limitations

- Application binaries are **unsigned** — SmartScreen on Windows, Gatekeeper
  right-click → Open on macOS. In-app *updates* are minisign-signed. SignPath is
  still tracked in `docs/TODO.md`.
- LSP is not wired up yet; completion is buffer/path/snippet based.
- No end-to-end test layer or systematic accessibility pass yet.
- Being `0.x`, settings and the harness contract may still change between minor
  versions.

## [0.1.0-beta.1] — 2026-07-21

First packaged test release.

### Added

- Multi-platform release pipeline (Windows NSIS, macOS DMG for arm64 + x64, Linux AppImage / deb / rpm).
- Full desktop icon set for installers (`tauri icon`).
- Version sync check (`pnpm check:version`) across `package.json`, `tauri.conf.json`, and `Cargo.toml`.
- Release documentation in `docs/releasing.md`.
- Windows NSIS + MSI build gate with a stable upgrade identity and artifact verification.
- Explorer **Open Folder with Glyphra**, `.glyphra-workspace`, and App Paths registration.
- Single-instance folder/file launch forwarding into the active IDE window.
- Windows background CLI processes stay hidden instead of opening console windows.
- Agent bridge and fixture runtimes are bundled with installed builds instead of resolving from the source tree.
- Windows Explorer text files expose **Open with Glyphra**, and Glyphra appears in the system **Open with** picker for common text formats.
- `File > Open File…` / `Ctrl+Shift+O` opens a single text or source file in a temporary parent-folder workspace; common source extensions also get explicit Explorer entries.

### Published assets (this tag)

- Linux x64: `.AppImage`, `.deb`, `.rpm` (built and uploaded).
- Windows / macOS installers: **pending** — GitHub Actions matrix could not start because the repo owner account hit a billing / spending-limit block. Re-run `.github/workflows/release.yml` after fixing Billing & plans.

### Included product surface (pre-alpha)

- Agent-native workspace: Codex, Claude Code, Pi, OpenCode, plus custom harnesses.
- Checkpointed review, session archives, provider usage snapshots.
- CodeMirror 6 editor, ripgrep search, PTY terminal, command palette, onboarding.

### Known limitations

- Unsigned binaries (SmartScreen / Gatekeeper warnings expected).
- No in-app updater yet — install from GitHub Releases.
- Per-project multi-window routing is still open (see `docs/TODO.md` when present).
- APIs and UI may break between commits.

[0.3.0]: https://github.com/Mar7thLover/Glyphra-IDE/releases/tag/v0.3.0
[0.2.0]: https://github.com/Mar7thLover/Glyphra-IDE/releases/tag/v0.2.0
[0.1.0-beta.1]: https://github.com/Mar7thLover/Glyphra-IDE/releases/tag/v0.1.0-beta.1
