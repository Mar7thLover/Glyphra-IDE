# AGENTS.md

## Cursor Cloud specific instructions

Glyphra is a single-product **Tauri 2 desktop app**: a React 19 + Vite + TypeScript
frontend (`src/`) driving a Rust backend (`src-tauri/`). There is one product and no
separate services — the frontend and the Rust core run together as one app.

### Running / building / testing

Standard commands live in `package.json` (`scripts`) and `.github/workflows/ci.yml`.
Use those as the source of truth. In short:

- Frontend dev server only (browser, no Rust IPC): `pnpm dev` (Vite on port 1420).
- Full desktop app (frontend + Rust window): `pnpm tauri dev`.
- Frontend checks: `pnpm typecheck`, `pnpm exec vite build`, `pnpm check:size`, `pnpm test`
  (there are currently no test files, so `pnpm test` passes with `--passWithNoTests`).
- Rust checks: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`,
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`,
  `cargo build --manifest-path src-tauri/Cargo.toml`.
- Backend self-check (no GUI needed): `./src-tauri/target/debug/glyphra --smoke` prints a
  JSON status line and exits.

### Non-obvious caveats

- **`icon.png` is required to build on Linux/macOS but is NOT committed.** The repo only
  ships `src-tauri/icons/icon.ico` (Windows-focused). `tauri::generate_context!` needs a
  32-bit **RGBA** `src-tauri/icons/icon.png`, otherwise the Rust build fails with
  "failed to open icon ... icon.png" or "icon ... is not RGBA". The update script
  regenerates it from the committed `.ico` via ImageMagick; if it ever goes missing, run:
  `convert "src-tauri/icons/icon.ico[0]" -resize 256x256 -alpha on -background none PNG32:src-tauri/icons/icon.png`.
  Note the upstream CI `tauri (ubuntu-latest)` / `tauri (macos-latest)` jobs currently
  fail for this same reason.
- **Rust toolchain must be recent.** A transitive dependency requires the `edition2024`
  Cargo feature, so Rust/Cargo older than ~1.85 fails to even parse the manifest. Use the
  latest stable (`rustup default stable`).
- **GUI needs a display.** The desktop window only appears when a display is available
  (this environment provides X11 `DISPLAY=:1`). The window starts hidden and is revealed
  by the frontend's `app_ready` IPC call after React mounts, so a blank/hidden window
  until the frontend loads is expected. `libEGL ... DRI3` warnings are harmless software-
  rendering fallbacks.
- The first `pnpm tauri dev` compiles the Rust crate (~1 min cold). Later reloads are fast;
  Vite hot-reloads the frontend and Rust changes trigger a recompile+relaunch.
