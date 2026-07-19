param(
  [string]$Binary = "src-tauri/target/release/glyphra.exe"
)

if (-not (Test-Path $Binary)) {
  throw "Glyphra binary not found: $Binary"
}

$json = & $Binary --smoke | Select-Object -First 1
$result = $json | ConvertFrom-Json
if (-not $result.ok) {
  throw "Smoke failed: $json"
}

"Smoke OK: $json"
