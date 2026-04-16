@echo off
setlocal EnableExtensions
REM ============================================================================
REM  install-service.cmd
REM
REM  Installs NuqtaPlusBackend as a Windows Service.
REM  Must be run as Administrator.
REM
REM  Steps:
REM    1. Verify elevation
REM    2. Verify NuqtaPlusBackend.exe + .xml are present
REM    3. Uninstall any prior service registration (idempotent)
REM    4. Install the service via the WinSW wrapper
REM    5. Configure delayed automatic start
REM    6. Grant BUILTIN\Users start/stop/query permissions on the service
REM    7. Start the service
REM ============================================================================

set "SVC_NAME=NuqtaPlusBackend"
set "SVC_DIR=%~dp0.."
set "SVC_EXE=%SVC_DIR%\%SVC_NAME%.exe"
set "SVC_XML=%SVC_DIR%\%SVC_NAME%.xml"

REM --- elevation check -------------------------------------------------------
net session >nul 2>&1
if errorlevel 1 (
  echo [install-service] ERROR: must run as Administrator.
  exit /b 1
)

if not exist "%SVC_EXE%" (
  echo [install-service] ERROR: %SVC_EXE% not found.
  exit /b 2
)
if not exist "%SVC_XML%" (
  echo [install-service] ERROR: %SVC_XML% not found.
  exit /b 3
)

REM --- idempotent uninstall of any prior registration ------------------------
sc.exe query "%SVC_NAME%" >nul 2>&1
if not errorlevel 1 (
  echo [install-service] existing service found - stopping and removing first
  sc.exe stop "%SVC_NAME%" >nul 2>&1
  "%SVC_EXE%" uninstall >nul 2>&1
  sc.exe delete "%SVC_NAME%" >nul 2>&1
)

echo [install-service] installing service from %SVC_EXE%
"%SVC_EXE%" install
if errorlevel 1 (
  echo [install-service] ERROR: WinSW install failed (exit %errorlevel%)
  exit /b 4
)

REM --- enforce delayed automatic start --------------------------------------
sc.exe config "%SVC_NAME%" start= delayed-auto >nul

REM --- grant Users start/stop/query so non-admin updates can manage it ------
REM SDDL legend:
REM   D: = DACL,  A = Allow,
REM   RP = SERVICE_START, WP = SERVICE_STOP, DT = SERVICE_PAUSE_CONTINUE,
REM   LO = SERVICE_INTERROGATE, CR = SERVICE_USER_DEFINED_CONTROL,
REM   SW = SERVICE_ENUMERATE_DEPENDENTS, RC = READ_CONTROL,
REM   LC = SERVICE_QUERY_STATUS, CC = SERVICE_QUERY_CONFIG
REM   BU = BUILTIN\Users, BA = BUILTIN\Administrators, SY = LocalSystem,
REM   IU = INTERACTIVE.
REM Users get: query/start/stop/interrogate/user-defined-control + read.
REM Admins / SYSTEM keep full control.
sc.exe sdset "%SVC_NAME%" "D:(A;;CCLCSWRPWPDTLOCRRC;;;BU)(A;;CCLCSWRPWPDTLOCRRC;;;IU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)S:(AU;FA;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;WD)" >nul

echo [install-service] starting service
sc.exe start "%SVC_NAME%" >nul
if errorlevel 1 (
  echo [install-service] WARNING: service installed but failed to start (exit %errorlevel%)
  echo [install-service] check logs at "%SVC_DIR%\logs"
  exit /b 5
)

echo [install-service] OK - %SVC_NAME% installed and running.
exit /b 0
