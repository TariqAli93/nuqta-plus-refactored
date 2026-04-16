@echo off
setlocal EnableExtensions
REM ============================================================================
REM  uninstall-service.cmd
REM
REM  Stops and removes the NuqtaPlusBackend Windows Service.
REM  Must be run as Administrator.
REM ============================================================================

set "SVC_NAME=NuqtaPlusBackend"
set "SVC_DIR=%~dp0.."
set "SVC_EXE=%SVC_DIR%\%SVC_NAME%.exe"

net session >nul 2>&1
if errorlevel 1 (
  echo [uninstall-service] ERROR: must run as Administrator.
  exit /b 1
)

sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [uninstall-service] %SVC_NAME% is not installed - nothing to do
  exit /b 0
)

echo [uninstall-service] stopping %SVC_NAME%
sc.exe stop "%SVC_NAME%" >nul 2>&1

REM Wait up to 15 seconds for STOPPED state before removing.
set /a _tries=0
:wait_stopped
sc.exe query "%SVC_NAME%" | findstr /C:"STOPPED" >nul
if not errorlevel 1 goto do_remove
set /a _tries+=1
if %_tries% GEQ 15 goto do_remove
ping -n 2 127.0.0.1 >nul
goto wait_stopped

:do_remove
if exist "%SVC_EXE%" (
  echo [uninstall-service] removing service via WinSW wrapper
  "%SVC_EXE%" uninstall >nul 2>&1
)

REM Belt and braces: also delete via SC in case WinSW failed.
sc.exe delete "%SVC_NAME%" >nul 2>&1

echo [uninstall-service] OK - %SVC_NAME% removed.
exit /b 0
