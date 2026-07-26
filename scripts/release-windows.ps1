$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$localKeyRoot = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".tauri"
$localKey = Join-Path $localKeyRoot "glyphra-updater.key"
$localPassword = Join-Path $localKeyRoot "glyphra-updater.password"

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
  if (-not (Test-Path -LiteralPath $localKey -PathType Leaf)) {
    throw "Missing TAURI_SIGNING_PRIVATE_KEY and local updater key: $localKey"
  }
  $env:TAURI_SIGNING_PRIVATE_KEY = $localKey
}

if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
  if (-not (Test-Path -LiteralPath $localPassword -PathType Leaf)) {
    throw "Missing TAURI_SIGNING_PRIVATE_KEY_PASSWORD and local password file: $localPassword"
  }
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.IO.File]::ReadAllText($localPassword).Trim()
}

Push-Location $projectRoot
try {
  & pnpm check:version
  if ($LASTEXITCODE -ne 0) { throw "Version check failed." }
  & pnpm tauri build --bundles "nsis,msi"
  if ($LASTEXITCODE -ne 0) { throw "Tauri Windows bundle build failed." }
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-bundle.ps1
  if ($LASTEXITCODE -ne 0) { throw "Windows bundle verification failed." }
} finally {
  Pop-Location
}
