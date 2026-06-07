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
; customInstall - register + start the backend service
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[NuqtaPlus] installing backend Windows Service..."

  ; Defensive idempotency: if a previous install left a service behind, stop
  ; and unregister it first so we never end up with a stale registration
  ; pointing at deleted files.
  nsExec::ExecToLog 'sc.exe stop "${NUQTA_SERVICE_NAME}"'
  Pop $0
  nsExec::ExecToLog '"${NUQTA_SERVICE_BIN}" uninstall'
  Pop $0
  nsExec::ExecToLog 'sc.exe delete "${NUQTA_SERVICE_NAME}"'
  Pop $0

  ; A stopped/deleted service can still leave a node.exe (or a leftover dev
  ; backend) holding the port. Kill it so the freshly-installed service binds
  ; the port cleanly and is the ONLY thing answering /version. Without this,
  ; an update can put new files on disk while a stale 1.0.x process keeps
  ; serving the old version.
  !insertmacro NuqtaFreeBackendPort

  IfFileExists "${NUQTA_SERVICE_BIN}" +3 0
    DetailPrint "[NuqtaPlus] ERROR: ${NUQTA_SERVICE_BIN} not found - aborting service install"
    Goto skipServiceInstall

  ; Register the service via the WinSW wrapper.
  nsExec::ExecToLog '"${NUQTA_SERVICE_BIN}" install'
  Pop $0
  IntCmp $0 0 +3 0 0
    DetailPrint "[NuqtaPlus] ERROR: WinSW install failed (exit $0)"
    Goto skipServiceInstall

  ; Force delayed automatic start (WinSW also writes this, but be explicit).
  nsExec::ExecToLog 'sc.exe config "${NUQTA_SERVICE_NAME}" start= delayed-auto'
  Pop $0

  ; Grant BUILTIN\Users start/stop/query so the Electron updater can manage
  ; the service from a non-elevated context. Admins/SYSTEM keep full control.
  nsExec::ExecToLog 'sc.exe sdset "${NUQTA_SERVICE_NAME}" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)"'
  Pop $0

  ; Allow non-admin users to update the backend bundle in place by granting
  ; modify rights on the backend directory only. The rest of $INSTDIR remains
  ; admin-only.
  nsExec::ExecToLog 'icacls.exe "${NUQTA_SERVICE_BACKEND}" /grant "*S-1-5-32-545:(OI)(CI)(M)" /T /C'
  Pop $0

  ; Start it now so the user's first launch finds a healthy backend.
  nsExec::ExecToLog 'sc.exe start "${NUQTA_SERVICE_NAME}"'
  Pop $0
  IntCmp $0 0 +3 0 0
    DetailPrint "[NuqtaPlus] WARNING: service installed but failed to start (exit $0)"
    Goto skipServiceInstall

  DetailPrint "[NuqtaPlus] backend service installed and running"

  ; Post-install verification: confirm the RUNNING backend reports the SAME
  ; version as the files we just installed. This is the gate that catches a
  ; stale process still holding the port (the classic "Electron expects vA,
  ; backend reports vB"). It does not abort the install — the files are correct
  ; and a reboot clears any squatter — but it logs a loud WARNING so a bad
  ; environment is visible in the install log.
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
; customUnInstall - stop + unregister the backend service
; ----------------------------------------------------------------------------
!macro customUnInstall
  DetailPrint "[NuqtaPlus] removing backend Windows Service..."

  ; Stop the service. Ignore errors — the service may already be stopped.
  nsExec::ExecToLog 'sc.exe stop "${NUQTA_SERVICE_NAME}"'
  Pop $0

  ; Wait briefly for the service to release file locks before unregistering.
  Sleep 1500

  ; Unregister via WinSW (clean path).
  IfFileExists "${NUQTA_SERVICE_BIN}" 0 +3
    nsExec::ExecToLog '"${NUQTA_SERVICE_BIN}" uninstall'
    Pop $0

  ; Belt-and-braces: also delete via SC in case WinSW failed or the binary
  ; was already removed.
  nsExec::ExecToLog 'sc.exe delete "${NUQTA_SERVICE_NAME}"'
  Pop $0

  ; Defensive cleanup: a service-hosted (or dev) node.exe has NO window title,
  ; so the previous WINDOWTITLE-based taskkill never matched it and could leave
  ; a backend alive on the port after uninstall. Kill by listening port instead
  ; — this reliably clears the bundled node bound to 127.0.0.1:41732.
  !insertmacro NuqtaFreeBackendPort

  DetailPrint "[NuqtaPlus] backend service removed"
!macroend
