<#
  verify-version.ps1

  Post-install / post-update guardrail.

  Confirms that the *running* NuqtaPlusBackend service reports the SAME version
  as the backend files actually on disk (resources/backend/package.json). This
  catches the failure mode where a stale process (e.g. a leftover dev backend,
  or the pre-update service still alive in memory) keeps holding port 41732 and
  answers /version with an OLD version after the files have already been
  upgraded — producing Electron's:

      Version mismatch (exact): Electron expects vA, backend reports vB

  Resolution when this script reports MISMATCH:
      net stop  NuqtaPlusBackend
      <ensure nothing else listens on 127.0.0.1:41732>
      net start NuqtaPlusBackend

  Exit codes:
      0  match        — running backend == files on disk
      1  mismatch     — a stale process is serving an old version on the port
      2  unreachable  — /version did not respond within the budget
      3  setup error  — package.json missing/unreadable

  Port 41732 mirrors BACKEND_PORT in packages/shared/index.js.
#>

$ErrorActionPreference = 'Stop'

$pkgPath    = Join-Path $PSScriptRoot '..\package.json'
$versionUrl = 'http://127.0.0.1:41732/version'
$maxRetries = 20

if (-not (Test-Path $pkgPath)) {
  Write-Host "[verify-version] ERROR: package.json not found at $pkgPath"
  exit 3
}

try {
  $expected = (Get-Content -Raw $pkgPath | ConvertFrom-Json).version
} catch {
  Write-Host "[verify-version] ERROR: cannot parse $pkgPath ($($_.Exception.Message))"
  exit 3
}
if ([string]::IsNullOrWhiteSpace($expected)) {
  Write-Host "[verify-version] ERROR: empty version field in package.json"
  exit 3
}

$actual = $null
for ($i = 1; $i -le $maxRetries; $i++) {
  try {
    $actual = (Invoke-RestMethod -Uri $versionUrl -TimeoutSec 2).version
    if ($actual) { break }
  } catch {
    Start-Sleep -Seconds 1
  }
}

if ([string]::IsNullOrWhiteSpace($actual)) {
  Write-Host "[verify-version] UNREACHABLE: $versionUrl did not respond (expected v$expected)"
  exit 2
}

if ($actual -eq $expected) {
  Write-Host "[verify-version] OK: backend reports v$actual (matches files on disk)"
  exit 0
}

Write-Host "[verify-version] MISMATCH: backend reports v$actual but files on disk are v$expected."
Write-Host "[verify-version] A stale process is likely holding port 41732. Stop it, then restart NuqtaPlusBackend."
exit 1
