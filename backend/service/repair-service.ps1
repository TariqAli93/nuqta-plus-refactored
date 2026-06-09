<#
  repair-service.ps1

  Self-elevating repair entry point for the NuqtaPlusBackend Windows Service.

  Why this exists:
    Installing/repairing a Windows Service requires Administrator. The Electron
    app runs NON-elevated, so when its startup self-heal detects a missing or
    broken service it cannot run sc.exe directly. This script is launched by
    serviceController.repairService() (non-elevated); it re-launches ITSELF
    elevated (one UAC prompt), runs the already-idempotent install-service.cmd,
    and propagates the real exit code back to the caller.

    Keeping the elevation here (instead of building a Start-Process command
    string in JavaScript) keeps the fragile UAC + quoting logic in one place
    that PowerShell parses correctly.

  install-service.cmd is idempotent (stop -> uninstall -> delete -> install ->
  config -> sdset -> start), so running it repairs both "service missing" and
  "service registered but broken/wrong-path".

  Exit codes (consumed by serviceController.repairService):
      0     repair succeeded (service installed and started)
      1-5   install-service.cmd failure (see that script's codes)
      1223  ERROR_CANCELLED — the user declined the UAC elevation prompt
#>

$ErrorActionPreference = 'Stop'

$installCmd = Join-Path $PSScriptRoot 'install-service.cmd'
if (-not (Test-Path $installCmd)) {
  Write-Host "[repair-service] ERROR: install-service.cmd not found at $installCmd"
  exit 2
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
}

# Already elevated (e.g. app was run as admin) — run the installer directly.
if (Test-Admin) {
  Write-Host "[repair-service] already elevated - running install-service.cmd"
  & cmd.exe /c "`"$installCmd`""
  exit $LASTEXITCODE
}

# Not elevated — re-launch install-service.cmd elevated, wait, propagate code.
# A declined UAC prompt makes Start-Process throw; map that to 1223 so the
# caller can show a "cancelled" message instead of crashing.
try {
  Write-Host "[repair-service] requesting elevation (UAC) to repair the service..."
  $p = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "`"$installCmd`"" `
        -Verb RunAs -Wait -PassThru -WindowStyle Hidden
  exit $p.ExitCode
} catch {
  Write-Host "[repair-service] elevation was cancelled or failed: $($_.Exception.Message)"
  exit 1223
}
