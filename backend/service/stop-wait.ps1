<#
  stop-wait.ps1

  Stop the NuqtaPlusBackend service and BLOCK until it has actually reached the
  STOPPED state (or a bounded timeout elapses).

  Why this exists:
    `sc.exe stop` is asynchronous — it returns as soon as the SCM *accepts* the
    STOP control, leaving the service in STOP_PENDING. WinSW's descriptor allows
    up to <stoptimeout>10 sec</stoptimeout> for node.exe to exit, so the wrapped
    process can keep holding file locks (bin\node.exe, logs\*) for several
    seconds after `sc stop` returns.

    During an electron-builder UPDATE the installer renames resources\backend
    aside immediately after customUnInstall runs. If node.exe is still alive the
    rename FAILS and the whole update aborts ("Can't rename $INSTDIR..."). So the
    update path MUST wait for a real STOPPED before the file move happens.

  Called (no args) by the NSIS NuqtaStopBackendService macro. Pairs with
  free-port.ps1, which the macro also runs as a hard backstop for any survivor
  still holding 127.0.0.1:41732.

  Always exits 0 — stopping an already-stopped/absent service is a no-op, never
  an error, so an installer step that calls this never fails on a clean machine.

  Service name mirrors BACKEND_SERVICE_NAME in packages/shared/index.js.
#>

param([int]$TimeoutSec = 20)

$ErrorActionPreference = 'SilentlyContinue'
$svc = 'NuqtaPlusBackend'

# Nothing to do if the service is not even registered.
$exists = sc.exe query $svc 2>$null | Out-String
if (-not $exists -or $exists -match '1060') {
  Write-Host "[stop-wait] $svc is not installed - nothing to stop"
  exit 0
}

sc.exe stop $svc | Out-Null

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  $q = sc.exe query $svc 2>$null | Out-String
  if (-not $q -or ($q -match '1060') -or ($q -match 'STOPPED')) {
    Write-Host "[stop-wait] $svc is stopped"
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Write-Host "[stop-wait] WARNING: $svc did not reach STOPPED within $TimeoutSec s (free-port.ps1 will clear any survivor)"
exit 0
