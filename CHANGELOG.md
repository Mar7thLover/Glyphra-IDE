# Changelog

All notable changes to Glyphra are documented here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/) with pre-release tags for test builds.

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

[0.1.0-beta.1]: https://github.com/Mar7thLover/Glyphra-IDE/releases/tag/v0.1.0-beta.1
