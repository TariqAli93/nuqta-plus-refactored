; ============================================================================
; installer-include-client.nsh
;
; NSIS macro hooks for the NuqtaPlus CLIENT installer.
;
; The CLIENT installer is intentionally a thin shell over the renderer:
;   - It does NOT ship the backend tree (resources/backend is absent).
;   - It does NOT install or manage the NuqtaPlusBackend Windows Service.
;   - It does NOT load ONNX or any ML artifacts locally.
;   - It connects to a remote NuqtaPlus SERVER over the LAN and uses the
;     server's HTTP API for all credit-risk scoring.
;
; Keeping these hooks as no-ops (rather than reusing the server hooks) prevents
; the client installer from accidentally touching Windows Services on customer
; workstations — installing or starting a service that has no backing files
; on this machine.
; ============================================================================

; ----------------------------------------------------------------------------
; customInstall - intentionally empty for the client. No backend service.
; ----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "[NuqtaPlus Client] no backend service to install (thin LAN client)"
!macroend

; ----------------------------------------------------------------------------
; customUnInstall - intentionally empty for the client.
; ----------------------------------------------------------------------------
!macro customUnInstall
  DetailPrint "[NuqtaPlus Client] no backend service to remove (thin LAN client)"
!macroend
