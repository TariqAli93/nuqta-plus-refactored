; ============================================================================
; installer-include.nsh
;
; electron-builder NSIS macro hooks for the NuqtaPlusBackend Windows Service.
;
; - customInstall:  invoked by the installer after files are copied. Registers
;                   and starts the backend service via the bundled WinSW host.
; - customUnInstall: invoked by the uninstaller before files are removed. Stops
;                   the backend service and unregisters it. Guarantees no
;                   orphan service or backend node.exe is left running.
;
; The service binary lives at:
;   $INSTDIR\resources\backend\NuqtaPlusBackend.exe
; with its descriptor at:
;   $INSTDIR\resources\backend\NuqtaPlusBackend.xml
;
; Both must exist before customInstall is called — afterPack.cjs verifies
; this during the build.
; ============================================================================

!define NUQTA_SERVICE_NAME    "NuqtaPlusBackend"
!define NUQTA_SERVICE_BACKEND "$INSTDIR\resources\backend"
!define NUQTA_SERVICE_BIN     "${NUQTA_SERVICE_BACKEND}\${NUQTA_SERVICE_NAME}.exe"

; ----------------------------------------------------------------------------
; NuqtaFreeBackendPort - kill any process still LISTENING on 127.0.0.1:41732.
;
; Stopping/deleting the service is not always enough: a node.exe spawned by the
; service host (or a leftover dev backend) can keep the port — and a Windows
; service process has NO window title, so the previous WINDOWTITLE-based
; taskkill never matched it. A survivor keeps answering /version with the OLD
; version after the files on disk were already upgraded, which is exactly what
; produces Electron's "Version mismatch: expects vA, backend reports vB".
;
; The kill logic lives in the shipped service\free-port.ps1 (not inline) so NSIS
; never has to expand a PowerShell $-token, and so the null-safe "nothing to
; kill" path stays clean (exit 0). Port 41732 mirrors BACKEND_PORT in
; packages/shared/index.js. afterPack.cjs verifies the script ships.
; ----------------------------------------------------------------------------
!macro NuqtaFreeBackendPort
  DetailPrint "[NuqtaPlus] freeing backend port 41732 (killing any stale listener)..."
  IfFileExists "${NUQTA_SERVICE_BACKEND}\service\free-port.ps1" 0 +3
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${NUQTA_SERVICE_BACKEND}\service\free-port.ps1"'
    Pop $0
!macroend

; ----------------------------------------------------------------------------
; NuqtaStopBackendService - stop the service and WAIT for it to fully stop,
; then free the port.
;
; Used by both customInstall (before (re)configuring) and customUnInstall (so
; the atomic file-move during an update can rename resources\backend without
; hitting a file lock held by a still-exiting node.exe). stop-wait.ps1 blocks
; until the service reports STOPPED (sc.exe stop is async and WinSW allows up to
; its stoptimeout); free-port.ps1 is the hard backstop for any survivor still
; bound to 127.0.0.1:41732. afterPack.cjs verifies both scripts ship.
; ----------------------------------------------------------------------------
!macro NuqtaStopBackendService
  DetailPrint "[NuqtaPlus] stopping backend service (waiting for STOPPED)..."
  IfFileExists "${NUQTA_SERVICE_BACKEND}\service\stop-wait.ps1" 0 +3
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${NUQTA_SERVICE_BACKEND}\service\stop-wait.ps1"'
    Pop $0
  !insertmacro NuqtaFreeBackendPort
!macroend

; ----------------------------------------------------------------------------
; customInstall - idempotently install/repair + start the backend service.
;
; Runs elevated (the perMachine installer carries RequestExecutionLevel admin),
; on both first install and update. It NEVER deletes an existing registration:
;   - service already registered (survived an update via the guarded
;     customUnInstall) -> refresh binPath + start policy, then start.
;   - service missing (first install, or recovery from an old broken update)
;     -> full WinSW install + start policy + ACLs.
; A failed START never aborts the install — the files on disk are correct and
; the Electron startup self-heal / next boot recovers.
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[NuqtaPlus] configuring backend Windows Service..."

  ; Release any running instance + the port so the new files are the only
  ; responder (and so a stale process can't keep serving the old /version).
  !insertmacro NuqtaStopBackendService

  IfFileExists "${NUQTA_SERVICE_BIN}" +3 0
    DetailPrint "[NuqtaPlus] ERROR: ${NUQTA_SERVICE_BIN} not found - aborting service install"
    Goto skipServiceInstall

  ; Is the service already registered? (It survives updates now.) sc query
  ; returns 0 when the service exists, 1060 otherwise.
  nsExec::ExecToLog 'sc.exe query "${NUQTA_SERVICE_NAME}"'
  Pop $0
  IntCmp $0 0 svcExists svcMissing svcMissing

  svcExists:
    DetailPrint "[NuqtaPlus] service already registered - refreshing config (no delete)"
    ; Refresh the binary path (corrects drift; no-op when unchanged) and keep
    ; delayed-auto start. WinSW registers ImagePath as the bare wrapper exe.
    nsExec::ExecToLog 'sc.exe config "${NUQTA_SERVICE_NAME}" binPath= "${NUQTA_SERVICE_BIN}" start= delayed-auto'
    Pop $0
    Goto svcStart

  svcMissing:
    DetailPrint "[NuqtaPlus] service not registered - installing via WinSW"
    nsExec::ExecToLog '"${NUQTA_SERVICE_BIN}" install'
    Pop $0
    IntCmp $0 0 +3 0 0
      DetailPrint "[NuqtaPlus] ERROR: WinSW install failed (exit $0)"
      Goto skipServiceInstall

    ; Force delayed automatic start (WinSW also writes this, but be explicit).
    nsExec::ExecToLog 'sc.exe config "${NUQTA_SERVICE_NAME}" start= delayed-auto'
    Pop $0

    ; Grant BUILTIN\Users start/stop/query so the Electron app can manage the
    ; service from a non-elevated context. Admins/SYSTEM keep full control.
    nsExec::ExecToLog 'sc.exe sdset "${NUQTA_SERVICE_NAME}" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)"'
    Pop $0

    ; Allow non-admin users to update the backend bundle in place by granting
    ; modify rights on the backend directory only. The rest of $INSTDIR stays
    ; admin-only.
    nsExec::ExecToLog 'icacls.exe "${NUQTA_SERVICE_BACKEND}" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C'
    Pop $0

  svcStart:
    ; Start it now so the user's first launch finds a healthy backend. A
    ; failure here is NOT fatal — do not abort the install.
    nsExec::ExecToLog 'sc.exe start "${NUQTA_SERVICE_NAME}"'
    Pop $0
    IntCmp $0 0 +2 0 0
      DetailPrint "[NuqtaPlus] WARNING: service registered but failed to start (exit $0) - Electron self-heal / next boot will retry"

    DetailPrint "[NuqtaPlus] backend service configured"

    ; Post-install verification: confirm the RUNNING backend reports the SAME
    ; version as the files we just installed. Catches a stale process still
    ; holding the port (the classic "Electron expects vA, backend reports vB").
    ; Never aborts — logs a loud WARNING so a bad environment is visible.
    IfFileExists "${NUQTA_SERVICE_BACKEND}\service\verify-version.ps1" 0 doneVerify
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "${NUQTA_SERVICE_BACKEND}\service\verify-version.ps1"'
      Pop $0
      IntCmp $0 0 verifyOk verifyBad verifyBad
      verifyBad:
        DetailPrint "[NuqtaPlus] WARNING: backend version verification failed (exit $0) - a stale process may still hold port 41732. Reboot, then relaunch."
        Goto doneVerify
      verifyOk:
        DetailPrint "[NuqtaPlus] backend version verified - service reports the installed version"
    doneVerify:

  skipServiceInstall:
!macroend

; ----------------------------------------------------------------------------
; customUnInstall - stop the service; only REMOVE it on a real uninstall.
;
; CRITICAL: during an electron-updater UPDATE the new installer runs the OLD
; uninstaller with --updated, so ${isUpdated} is TRUE here. In that case we must
; NOT delete the service — deleting it during the update window is exactly what
; made NuqtaPlusBackend disappear after every update. We only STOP it (and free
; the port) so the subsequent atomic file-move of resources\backend succeeds;
; the new customInstall then refreshes + starts the surviving registration.
;
; On a real Control-Panel uninstall ${isUpdated} is FALSE -> fully remove the
; service (stop + WinSW uninstall + sc delete + free port).
; ----------------------------------------------------------------------------
!macro customUnInstall
  ${if} ${isUpdated}
    DetailPrint "[NuqtaPlus] update in progress - stopping service but PRESERVING its registration"
    !insertmacro NuqtaStopBackendService
  ${else}
    DetailPrint "[NuqtaPlus] uninstall - removing backend Windows Service..."
    !insertmacro NuqtaStopBackendService

    ; Unregister via WinSW (clean path).
    IfFileExists "${NUQTA_SERVICE_BIN}" 0 +3
      nsExec::ExecToLog '"${NUQTA_SERVICE_BIN}" uninstall'
      Pop $0

    ; Belt-and-braces: also delete via SC in case WinSW failed or the binary
    ; was already removed.
    nsExec::ExecToLog 'sc.exe delete "${NUQTA_SERVICE_NAME}"'
    Pop $0

    DetailPrint "[NuqtaPlus] backend service removed"
  ${endif}
!macroend
