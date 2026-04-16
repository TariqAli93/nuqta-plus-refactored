@echo off
setlocal EnableExtensions
sc.exe query "NuqtaPlusBackend" >nul 2>&1
if errorlevel 1 (
  echo [restart-service] ERROR: NuqtaPlusBackend is not installed.
  exit /b 1
)
sc.exe stop "NuqtaPlusBackend" >nul 2>&1
set /a _tries=0
:wait_stopped
sc.exe query "NuqtaPlusBackend" | findstr /C:"STOPPED" >nul
if not errorlevel 1 goto do_start
set /a _tries+=1
if %_tries% GEQ 15 goto do_start
ping -n 2 127.0.0.1 >nul
goto wait_stopped
:do_start
sc.exe start "NuqtaPlusBackend"
exit /b %errorlevel%
