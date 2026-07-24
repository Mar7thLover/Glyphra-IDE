# Releasing Glyphra

How to cut a packaged build for Windows, macOS, and Linux.

## Artifacts

| Platform | Runner | Bundles |
| --- | --- | --- |
| Windows x64 | `windows-latest` | NSIS `.exe`, Windows Installer `.msi`, and portable `.exe` |
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

WiX/MSI only accepts numeric product versions. For a prerelease, also advance
`bundle.windows.wix.version` in `tauri.conf.json` using
`major.minor.patch.prereleaseNumber` (for example, `0.1.0-beta.1` maps to
`0.1.0.1`). Keep the committed `upgradeCode` unchanged for every release.

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

On Windows, the beta release gate builds both installer formats and verifies
their presence, SHA-256 hashes, and 30 MiB size budget:

```powershell
pnpm release:windows
```

Outputs land under `src-tauri/target/release/bundle/` (plus the unbundled binary under `src-tauri/target/release/`).

Platform overrides:

- Linux: `src-tauri/tauri.linux.conf.json` (decorated window)
- macOS: `src-tauri/tauri.macos.conf.json` (decorated window)
- Windows: Mica / custom titlebar from the base `tauri.conf.json`

### Windows system integration

The NSIS installer can install for the current user or all users. It registers:

- Start Menu / optional desktop shortcuts and Windows Add or Remove Programs
- **Open Folder with Glyphra** for folders and Explorer folder backgrounds
- **Open with Glyphra** for text files, plus the Windows **Open with** picker
- explicit Explorer entries for common source files (`.c/.cpp/.h/.cs/.go/.java/.js/.ts/.tsx/.py/.rs/.html/.css` and related formats)
- the `.glyphra-workspace` file type
- `Glyphra.exe` under Windows App Paths (usable from Win+R and ShellExecute)

The MSI receives the standard Tauri shortcuts, uninstall registration, and
`.glyphra-workspace` association. Its stable WiX UpgradeCode is committed in
`src-tauri/tauri.conf.json`, so later beta installers upgrade the same product.

Both formats use the system WebView2 runtime and download the Microsoft
bootstrapper only when WebView2 is missing. The NSIS installer supports silent
install with `/S`; MSI supports `msiexec /i <package.msi> /quiet`.

The build also bundles the agent protocol bridge and offline fixture under the
installed `runtime/` directory. `pnpm build:runtime` regenerates these standalone
Node payloads; release builds run it automatically. Background CLI processes use
hidden Windows process creation so Git, Node, PowerShell, and provider probes do
not open external console windows.

A workspace descriptor is UTF-8 JSON and opens the first folder:

```json
{
  "folders": [{ "path": "." }]
}
```

Installed Explorer and workspace launches are forwarded to the running Glyphra
instance. You can also launch an unpacked build as `glyphra.exe <folder-or-file>`.
Inside Glyphra, `File > Open File…` (`Ctrl+Shift+O`) opens one text/source file
and uses its parent directory as a temporary project workspace.

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
