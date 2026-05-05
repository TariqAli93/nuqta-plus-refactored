@echo off
setlocal EnableExtensions
REM ============================================================================
REM  stop-service.bat
REM
REM  Stops NuqtaPlusBackend Windows Service and waits for STOPPED.
REM  Must be run as Administrator.
REM ============================================================================

set "SVC_NAME=NuqtaPlusBackend"

sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [stop-service] %SVC_NAME% is not installed - nothing to do.
  exit /b 0
)

sc.exe query "%SVC_NAME%" | findstr /C:"STOPPED" >nul
if not errorlevel 1 (
  echo [stop-service] %SVC_NAME% is already stopped.
  exit /b 0
)

echo [stop-service] stopping %SVC_NAME%
sc.exe stop "%SVC_NAME%" >nul 2>&1

set /a _tries=0
:wait_stopped
sc.exe query "%SVC_NAME%" | findstr /C:"STOPPED" >nul
if not errorlevel 1 (
  echo [stop-service] OK - %SVC_NAME% is STOPPED.
  exit /b 0
)
set /a _tries+=1
if %_tries% GEQ 30 (
  echo [stop-service] ERROR: %SVC_NAME% did not reach STOPPED within timeout.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_stopped
