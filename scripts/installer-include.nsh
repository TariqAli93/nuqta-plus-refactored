; ============================================================================
; installer-include.nsh
;
; electron-builder NSIS macro hooks for the NuqtaPlus Server installer.
;
; Production flow:
;   1. The installer copies all files (perMachine, elevated).
;   2. customInstall runs %INSTDIR%\resources\tools\bootstrap.bat to:
;        - create the nuqta_db database (if missing)
;        - apply Drizzle migrations
;        - install the NuqtaPlusBackend Windows Service
;        - start the service and verify port 41732 is LISTENING
;      The frontend launch step is suppressed here via
;      NUQTA_BOOTSTRAP_NO_LAUNCH=1 so the installer doesn't open the app
;      before the user clicks Finish.
;   3. customUnInstall stops + removes the NuqtaPlusBackend service so a
;      reinstall doesn't trip over a stale service registration.
;
; bootstrap.bat is idempotent and safe to re-run manually if PostgreSQL
; was not yet installed when the user ran the installer:
;     %INSTDIR%\resources\tools\bootstrap.bat   (Run as Administrator)
; ============================================================================

!define NUQTA_SERVICE_NAME    "NuqtaPlusBackend"
!define NUQTA_RESOURCES       "$INSTDIR\resources"
!define NUQTA_BOOTSTRAP_BAT   "${NUQTA_RESOURCES}\tools\bootstrap.bat"
!define NUQTA_SERVICE_BACKEND "${NUQTA_RESOURCES}\backend"
!define NUQTA_SERVICE_DIR     "${NUQTA_SERVICE_BACKEND}\service"
!define NUQTA_SERVICE_BIN     "${NUQTA_SERVICE_DIR}\${NUQTA_SERVICE_NAME}.exe"

; ----------------------------------------------------------------------------
; customInstall - run bootstrap.bat automatically as part of install.
;                 Errors are reported in the installer log but do not abort
;                 the install — the user can re-run bootstrap.bat manually
;                 once PostgreSQL is available.
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[NuqtaPlus] running first-run bootstrap..."

  IfFileExists "${NUQTA_BOOTSTRAP_BAT}" 0 bootstrapMissing
    ; NUQTA_BOOTSTRAP_NO_LAUNCH=1 prevents bootstrap.bat from spawning the
    ; desktop app while the installer is still on screen.
    nsExec::ExecToLog 'cmd.exe /c set "NUQTA_BOOTSTRAP_NO_LAUNCH=1" && "${NUQTA_BOOTSTRAP_BAT}"'
    Pop $0
    IntCmp $0 0 bootstrapOk 0 0
      DetailPrint "[NuqtaPlus] WARNING: bootstrap.bat exited with $0."
      DetailPrint "[NuqtaPlus]          Re-run resources\tools\bootstrap.bat as Administrator after"
      DetailPrint "[NuqtaPlus]          fixing the issue (e.g. install PostgreSQL 18, check credentials)."
      Goto bootstrapDone
    bootstrapOk:
      DetailPrint "[NuqtaPlus] bootstrap completed successfully."
      Goto bootstrapDone
  bootstrapMissing:
    DetailPrint "[NuqtaPlus] ERROR: ${NUQTA_BOOTSTRAP_BAT} is missing - skipping bootstrap."
  bootstrapDone:
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
