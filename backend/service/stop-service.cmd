@echo off
setlocal EnableExtensions
sc.exe query "NuqtaPlusBackend" >nul 2>&1
if errorlevel 1 (
  echo [stop-service] ERROR: NuqtaPlusBackend is not installed.
  exit /b 1
)
sc.exe stop "NuqtaPlusBackend"
exit /b %errorlevel%
