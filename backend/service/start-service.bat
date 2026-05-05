@echo off
setlocal EnableExtensions
REM ============================================================================
REM  start-service.bat
REM
REM  Starts NuqtaPlusBackend Windows Service and waits for RUNNING.
REM  Must be run as Administrator.
REM ============================================================================

set "SVC_NAME=NuqtaPlusBackend"

sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [start-service] ERROR: %SVC_NAME% is not installed.
  exit /b 1
)

sc.exe query "%SVC_NAME%" | findstr /C:"RUNNING" >nul
if not errorlevel 1 (
  echo [start-service] %SVC_NAME% is already running.
  exit /b 0
)

echo [start-service] starting %SVC_NAME%
sc.exe start "%SVC_NAME%" >nul
if errorlevel 1 (
  echo [start-service] ERROR: sc start failed (exit %errorlevel%)
  exit /b 1
)

set /a _tries=0
:wait_running
sc.exe query "%SVC_NAME%" | findstr /C:"RUNNING" >nul
if not errorlevel 1 (
  echo [start-service] OK - %SVC_NAME% is RUNNING.
  exit /b 0
)
set /a _tries+=1
if %_tries% GEQ 30 (
  echo [start-service] ERROR: %SVC_NAME% did not reach RUNNING within timeout.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_running
