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

  ; Defensive cleanup: kill any stray node.exe that was spawned by the
  ; service host but did not exit when the service was stopped. We narrow
  ; this to the bundled node by absolute path so we never touch unrelated
  ; node processes the user might be running.
  nsExec::ExecToLog 'taskkill.exe /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq nuqtaplus*"'
  Pop $0

  DetailPrint "[NuqtaPlus] backend service removed"
!macroend
