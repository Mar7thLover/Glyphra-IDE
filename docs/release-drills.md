# Release and fault drills

Run this checklist for every beta or release candidate. Record the Windows build
number, baseline version, candidate version, installer hashes, and operator in
the release issue. A completed checklist is evidence for the release gate; the
repository automation prepares and validates artifacts but cannot certify a
clean virtual machine on its own.

## Clean Windows 11 install

Use a newly-created Windows 11 x64 VM or Windows Sandbox image with no prior
Glyphra installation.

1. Download the NSIS installer and its published SHA-256 value.
2. Verify the hash with `Get-FileHash <installer.exe> -Algorithm SHA256`.
3. Install for the current user. Confirm the Start menu entry, Add/Remove
   Programs entry, desktop shortcut (if selected), and Explorer file/folder
   context menu entries.
4. Launch Glyphra, open a folder, edit and save a UTF-8 file, open the terminal,
   and run the bundled offline replay agent.
5. Close every Glyphra window. In Task Manager, confirm that no `glyphra.exe`,
   replay-agent, harness-bridge, shell, or PTY child remains.
6. Uninstall Glyphra and confirm the application and Explorer registrations are
   removed.
7. Repeat steps 1–6 with the MSI installer.

The local artifact gate used before copying installers into the VM is:

```powershell
pnpm release:windows
```

It requires the local minisign key under `%USERPROFILE%\.tauri` or the two
`TAURI_SIGNING_PRIVATE_KEY*` environment variables. It verifies NSIS, MSI,
portable binary, bundled runtime files, `THIRD-PARTY.md`, update artifacts, and
their `.sig` files. On Windows, Tauri signs the NSIS/MSI installer directly;
other platforms may use compressed updater archives.

## In-app update (`v0.x` to `v0.x+1`)

1. Publish the baseline as a prerelease and install it in the clean VM.
2. Publish the candidate with a strictly greater SemVer. Confirm the release
   contains `latest.json`, the platform update artifacts, and matching `.sig`
   files.
3. In the baseline, open a project, create an unsaved edit, and start the offline
   replay agent.
4. Open **Settings → About → Check for updates**. Confirm the candidate version
   and notes, download progress, and the restart/install action.
5. Install and relaunch. Confirm the candidate version in About, recovery of the
   unsaved buffer, the same project window, and that the previous agent process
   no longer exists.
6. Confirm a second check reports that the app is current.
7. Attempt a locally modified archive/signature pair and confirm Glyphra rejects
   it before installation.

The release workflow needs repository secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public
key is committed in `src-tauri/tauri.conf.json`; never commit the private key or
password.

## Debug fault drills

Fault controls are intentionally available only in development builds under
**Settings → About → Fault drills**.

1. **React render throw:** trigger the React fault. Confirm the error boundary
   appears, diagnostics can be copied, and Reload returns to a usable window.
2. **Rust panic:** trigger the Rust fault with the confirmation prompt. Confirm
   `%LOCALAPPDATA%\dev.glyphra.ide\logs\panic.log` contains the intentional
   panic and the remaining app windows stay responsive.
3. **Forced recovery:** open a project, make an unsaved edit, trigger recovery,
   and confirm the content returns after reload. Modify the file externally
   before reload and confirm the recovery conflict notice appears.
4. **Orphan-process check:** start an agent, agent terminal, PTY, and search;
   take a resource snapshot, close the owning project window, then take another
   snapshot from a remaining window. Counts for the closed window must be zero,
   and Task Manager must show no matching child process.

Attach the relevant `panic.log` excerpt, before/after resource snapshots, and
diagnostic bundle to the release issue. Do not include source files or secrets
in the diagnostic bundle.
