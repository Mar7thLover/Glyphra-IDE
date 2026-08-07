$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = Join-Path $projectRoot "src-tauri\target\release"
$bundleRoot = Join-Path $releaseRoot "bundle"
$maxInstallerBytes = 30MB
$runtimeNames = @(
  "codex-app-server-daemon.mjs",
  "harness-bridge.mjs"
)

$portable = Join-Path $releaseRoot "glyphra.exe"
$nsis = @(Get-ChildItem -Path (Join-Path $bundleRoot "nsis") -Filter "*.exe" -File -ErrorAction SilentlyContinue)
$msi = @(Get-ChildItem -Path (Join-Path $bundleRoot "msi") -Filter "*.msi" -File -ErrorAction SilentlyContinue)

if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) {
  throw "Missing portable executable: $portable"
}
if ($nsis.Count -eq 0) {
  throw "No NSIS installer found under $bundleRoot\nsis"
}
if ($msi.Count -eq 0) {
  throw "No MSI installer found under $bundleRoot\msi"
}
$updaterArtifacts = $nsis + $msi
foreach ($artifact in $updaterArtifacts) {
  $signature = "$($artifact.FullName).sig"
  if (-not (Test-Path -LiteralPath $signature -PathType Leaf)) {
    throw "Missing minisign signature for updater artifact: $signature"
  }
  if ((Get-Item -LiteralPath $signature).Length -lt 100) {
    throw "Updater signature is unexpectedly small: $signature"
  }
}

$nsisManifest = Join-Path $releaseRoot "nsis\x64\installer.nsi"
$wixManifest = Join-Path $releaseRoot "wix\x64\main.wxs"
$nsisHooks = Join-Path $projectRoot "src-tauri\windows\hooks.nsh"
$wixFragment = Join-Path $projectRoot "src-tauri\windows\wix\file-context-menu.wxs"
$tauriConfig = Get-Content -Raw -LiteralPath (
  Join-Path $projectRoot "src-tauri\tauri.conf.json"
) | ConvertFrom-Json
foreach ($name in $runtimeNames) {
  $runtimePath = Join-Path $projectRoot "src-tauri\resources\runtime\$name"
  if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
    throw "Missing generated runtime resource: $runtimePath"
  }
  foreach ($manifest in @($nsisManifest, $wixManifest)) {
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
      throw "Missing generated installer manifest: $manifest"
    }
    if (-not (Select-String -LiteralPath $manifest -SimpleMatch $name -Quiet)) {
      throw "Installer manifest does not include runtime resource ${name}: $manifest"
    }
  }
}

foreach ($manifest in @($nsisManifest, $wixManifest)) {
  if (-not (Select-String -LiteralPath $manifest -SimpleMatch "THIRD-PARTY.md" -Quiet)) {
    throw "Installer manifest does not include THIRD-PARTY.md: $manifest"
  }
}

$nsisShellMarkers = @(
  "SystemFileAssociations\text\shell\Glyphra.OpenFile",
  '!insertmacro REGISTER_GLYPHRA_TEXT_EXTENSION "rs"',
  "Applications\Glyphra.exe\SupportedTypes",
  "OpenWithProgids"
)
foreach ($marker in $nsisShellMarkers) {
  if (-not (Select-String -LiteralPath $nsisHooks -SimpleMatch $marker -Quiet)) {
    throw "NSIS installer does not include text-file shell registration: $marker"
  }
}
if (Select-String -LiteralPath $nsisHooks -SimpleMatch "Glyphra\Capabilities" -Quiet) {
  throw "NSIS installer must not register Glyphra as a Default Apps candidate"
}
if (Select-String -LiteralPath $nsisManifest -SimpleMatch 'APP_ASSOCIATE "txt"' -Quiet) {
  throw "Generated NSIS installer must not replace text-file default handlers"
}
if (-not (Select-String -LiteralPath $nsisManifest -SimpleMatch "hooks.nsh" -Quiet)) {
  throw "Generated NSIS installer does not include the Glyphra installer hooks"
}

$wixShellMarkers = @(
  "SystemFileAssociations\text\shell\Glyphra.OpenFile",
  "SystemFileAssociations\.rs\shell\Glyphra.OpenFile",
  "Applications\Glyphra.exe\SupportedTypes",
  "OpenWithProgids"
)
foreach ($marker in $wixShellMarkers) {
  if (-not (Select-String -LiteralPath $wixFragment -SimpleMatch $marker -Quiet)) {
    throw "MSI installer does not include text-file shell registration: $marker"
  }
}
if (Select-String -LiteralPath $wixFragment -SimpleMatch "Glyphra\Capabilities" -Quiet) {
  throw "MSI installer must not register Glyphra as a Default Apps candidate"
}
if (Select-String -LiteralPath $wixManifest -SimpleMatch 'ProgId Id="Glyphra.txt"' -Quiet) {
  throw "Generated MSI installer must not replace text-file default handlers"
}
if (-not (Select-String -LiteralPath $wixManifest -SimpleMatch "GlyphraTextFileShellIntegration" -Quiet)) {
  throw "Generated MSI manifest does not include the text-file shell component"
}

$nonWorkspaceAssociations = @(
  $tauriConfig.bundle.fileAssociations |
    Where-Object { -not ($_.ext -contains "glyphra-workspace") }
)
if ($nonWorkspaceAssociations.Count -gt 0) {
  throw "Common text/source extensions must use additive installer hooks, not Tauri fileAssociations"
}

$artifacts = @((Get-Item -LiteralPath $portable)) + $nsis + $msi
foreach ($artifact in $artifacts) {
  if ($artifact.Length -le 1MB) {
    throw "Artifact is unexpectedly small: $($artifact.FullName)"
  }
  if ($artifact.Extension -ne ".exe" -or $artifact.FullName -ne $portable) {
    if ($artifact.Length -gt $maxInstallerBytes) {
      throw "Installer exceeds the 30 MiB beta budget: $($artifact.FullName)"
    }
  }
  $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash
  Write-Host ("OK {0} ({1:N2} MiB) SHA256={2}" -f $artifact.FullName, ($artifact.Length / 1MB), $hash)
}

foreach ($artifact in $updaterArtifacts) {
  Write-Host "OK signed updater $($artifact.FullName)"
}

Write-Host "Windows beta bundle verification passed."
