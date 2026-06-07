<#
  free-port.ps1

  Kill any process currently LISTENING on the backend port (default 41732 =
  127.0.0.1, mirrors BACKEND_PORT in packages/shared/index.js).

  Why this exists:
    Stopping/deleting the Windows service is not always enough — a node.exe
    spawned by the service host, or a leftover `node src/server.js` dev backend,
    can keep the port. A service/dev process has NO window title, so the old
    taskkill "WINDOWTITLE eq nuqtaplus*" filter never matched it. A survivor
    keeps answering /version with the OLD version after the files on disk were
    already upgraded, producing Electron's:
        Version mismatch (exact): Electron expects vA, backend reports vB

  Called (no args) by the NSIS installer/uninstaller right before it starts /
  after it removes the service, and runnable by hand to clear a stuck port.

  Always exits 0 — freeing a port that is already free is a no-op, never an
  error, so an installer step that calls this never fails on a clean machine.
#>

param([int]$Port = 41732)

$ErrorActionPreference = 'SilentlyContinue'

$listenerPids = @(
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
)

if ($listenerPids.Count -eq 0) {
  Write-Host "[free-port] nothing listening on port $Port"
  exit 0
}

foreach ($procId in $listenerPids) {
  if (-not $procId -or $procId -eq 0) { continue }
  $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  if ($?) {
    Write-Host "[free-port] killed PID $procId ($name) on port $Port"
  } else {
    Write-Host "[free-port] could not kill PID $procId ($name) on port $Port"
  }
}

exit 0
