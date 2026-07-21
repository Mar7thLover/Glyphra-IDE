# Releasing Glyphra

How to cut a packaged build for Windows, macOS, and Linux.

## Artifacts

| Platform | Runner | Bundles |
| --- | --- | --- |
| Windows x64 | `windows-latest` | NSIS `.exe` installer + plain `.exe` binary |
| macOS Apple Silicon | `macos-latest` (`aarch64-apple-darwin`) | `.dmg` / `.app` |
| macOS Intel | `macos-latest` (`x86_64-apple-darwin`) | `.dmg` / `.app` |
| Linux x64 | `ubuntu-22.04` | `.AppImage`, `.deb`, `.rpm` |

Pipeline: [`.github/workflows/release.yml`](../.github/workflows/release.yml) via [`tauri-apps/tauri-action@v1`](https://github.com/tauri-apps/tauri-action).

## Version sync

Keep these three equal (enforced by `pnpm check:version`):

1. `package.json` → `version`
2. `src-tauri/tauri.conf.json` → `version`
3. `src-tauri/Cargo.toml` → `package.version`

Current first test line: **`0.1.0-beta.1`**.

Semver with a pre-release suffix (`-beta.N`, `-rc.N`) is marked as a GitHub **prerelease** automatically.

## Cut a release

### 1. Bump version on `main` (or a release PR)

```sh
# edit the three version fields, then:
pnpm check:version
```

Update [`CHANGELOG.md`](../CHANGELOG.md) with the release notes.

### 2. Merge to `main`

CI (`ci.yml`) must be green.

### 3. Tag and push

```sh
git checkout main
git pull origin main
git tag -a "v0.1.0-beta.1" -m "Glyphra v0.1.0-beta.1"
git push origin "v0.1.0-beta.1"
```

Pushing `v*` triggers `release.yml`. The action creates/updates the GitHub Release and uploads installers from every matrix leg.

### Manual run

Actions → **release** → **Run workflow**. Optional inputs:

- `prerelease` (default `true`)
- `draft` (default `false`)

Uses the version currently in `tauri.conf.json` (no tag required, but the action still creates `v__VERSION__`).

## Local package build

Prerequisites match [AGENTS.md](../AGENTS.md) / the README.

```sh
pnpm install
pnpm check:version
pnpm tauri build
```

Outputs land under `src-tauri/target/release/bundle/` (plus the unbundled binary under `src-tauri/target/release/`).

Platform overrides:

- Linux: `src-tauri/tauri.linux.conf.json` (decorated window)
- macOS: `src-tauri/tauri.macos.conf.json` (decorated window)
- Windows: Mica / custom titlebar from the base `tauri.conf.json`

## Signing (not yet)

v0.x ships **unsigned**:

- Windows: expect SmartScreen; document “More info → Run anyway”.
- macOS: Gatekeeper — right-click → Open on first launch.
- Code signing / notarization / SignPath are post-beta (see [TODO.md](./TODO.md)).

In-app updater (`tauri-plugin-updater` + minisign) is intentionally **not** wired for the first beta; GitHub Releases are the distribution channel.

## Verify a build

1. Install from the Release asset for your OS.
2. Launch Glyphra; window reveals after the frontend calls `app_ready`.
3. Settings → About should reflect the tagged version once UI wiring lands; until then check the installer filename / Release title.
4. Optional: onboarding detects git / Node / agent CLIs.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Actions jobs fail immediately with billing / spending-limit message | Owner must fix **Billing & plans** (payment method or raise spending limit), then re-run `release.yml` or re-push the tag. Linux assets for `v0.1.0-beta.1` were uploaded manually when this hit. |
| `Resource not accessible by integration` | Repo Settings → Actions → General → Workflow permissions → **Read and write**. |
| Linux WebKit missing | Workflow installs `libwebkit2gtk-4.1-dev`; locally install the same. |
| Version mismatch job fails | Run `pnpm check:version` and align the three manifests. |
| macOS Intel vs ARM | Both targets are built; download the matching `.dmg`. |
