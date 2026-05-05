@echo off
setlocal EnableExtensions
REM ============================================================================
REM  install-service.bat
REM
REM  Registers the NuqtaPlusBackend Windows Service via the bundled WinSW
REM  wrapper. Idempotent: if the service already exists, leaves it alone.
REM  Must be run as Administrator.
REM ============================================================================

set "SVC_NAME=NuqtaPlusBackend"
set "SVC_DIR=%~dp0"
set "BACKEND_DIR=%SVC_DIR%.."
set "SVC_EXE=%SVC_DIR%%SVC_NAME%.exe"
set "SVC_XML=%SVC_DIR%%SVC_NAME%.xml"

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

sc.exe query "%SVC_NAME%" >nul 2>&1
if not errorlevel 1 (
  echo [install-service] %SVC_NAME% already installed - skipping registration.
  exit /b 0
)

echo [install-service] installing %SVC_NAME%
"%SVC_EXE%" install
if errorlevel 1 (
  echo [install-service] ERROR: WinSW install failed (exit %errorlevel%)
  exit /b 4
)

sc.exe config "%SVC_NAME%" start= delayed-auto >nul

echo [install-service] OK - %SVC_NAME% installed.
exit /b 0
