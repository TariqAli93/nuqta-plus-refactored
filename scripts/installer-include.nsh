; ============================================================================
; installer-include.nsh
;
; electron-builder NSIS macro hooks for the NuqtaPlus Server installer.
;
; The installer copies files only. It does NOT install or start the
; NuqtaPlusBackend Windows Service — that is the responsibility of
; tools\bootstrap.bat, which the operator runs once after install:
;
;   1. Install NuqtaPlus Server (this installer copies files).
;   2. Right-click tools\bootstrap.bat → Run as administrator.
;      That script creates the database, runs migrations, installs the
;      Windows service, starts the service, and launches the desktop app.
;
; - customInstall:   no-op. Files are copied by electron-builder; nothing
;                    is started or registered here.
; - customUnInstall: stops and removes the NuqtaPlusBackend service if
;                    bootstrap.bat had previously installed it. This avoids
;                    leaving a stale service registration pointing at
;                    deleted files.
; ============================================================================

!define NUQTA_SERVICE_NAME    "NuqtaPlusBackend"
!define NUQTA_SERVICE_BACKEND "$INSTDIR\resources\backend"
!define NUQTA_SERVICE_DIR     "${NUQTA_SERVICE_BACKEND}\service"
!define NUQTA_SERVICE_BIN     "${NUQTA_SERVICE_DIR}\${NUQTA_SERVICE_NAME}.exe"

; ----------------------------------------------------------------------------
; customInstall - intentionally no-op. Service install is handled by
;                 tools\bootstrap.bat run as Administrator.
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[NuqtaPlus] files copied. Run tools\bootstrap.bat as Administrator to finish setup."
!macroend

; ----------------------------------------------------------------------------
; customUnInstall - stop + unregister the backend service if it was
;                   previously installed by bootstrap.bat.
; ----------------------------------------------------------------------------
!macro customUnInstall
  DetailPrint "[NuqtaPlus] removing backend Windows Service if present..."

  nsExec::ExecToLog 'sc.exe stop "${NUQTA_SERVICE_NAME}"'
  Pop $0

  Sleep 1500

  IfFileExists "${NUQTA_SERVICE_BIN}" 0 +3
    nsExec::ExecToLog '"${NUQTA_SERVICE_BIN}" uninstall'
    Pop $0

  nsExec::ExecToLog 'sc.exe delete "${NUQTA_SERVICE_NAME}"'
  Pop $0

  DetailPrint "[NuqtaPlus] backend service removed (if it was installed)"
!macroend
