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
if ($null -eq $result.rssMb) {
  throw "Smoke missing rssMb: $json"
}
# Binary-only smoke (no WebView). Keep a generous ceiling so CI fails on
# accidental giant static linkage rather than chasing interactive RSS here.
if ([double]$result.rssMb -gt 80) {
  throw "Smoke RSS too high for binary-only mode: $($result.rssMb) MB"
}

"Smoke OK: $json"
