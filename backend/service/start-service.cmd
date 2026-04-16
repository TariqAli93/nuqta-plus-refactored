@echo off
setlocal EnableExtensions
sc.exe query "NuqtaPlusBackend" >nul 2>&1
if errorlevel 1 (
  echo [start-service] ERROR: NuqtaPlusBackend is not installed.
  exit /b 1
)
sc.exe start "NuqtaPlusBackend"
exit /b %errorlevel%
