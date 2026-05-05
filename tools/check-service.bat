@echo off
setlocal EnableExtensions
REM ============================================================================
REM  tools\check-service.bat
REM
REM  Diagnoses the NuqtaPlusBackend Windows Service:
REM    - sc query state
REM    - whether port 41732 is listening
REM ============================================================================

set "SVC_NAME=NuqtaPlusBackend"
set "BACKEND_PORT=41732"

echo [check-service] querying %SVC_NAME%
sc.exe query "%SVC_NAME%"
if errorlevel 1 (
  echo [check-service] %SVC_NAME% is NOT installed.
)

echo.
echo [check-service] checking port %BACKEND_PORT%
netstat -ano -p TCP | findstr /R /C:":%BACKEND_PORT% .*LISTENING"
if errorlevel 1 (
  echo [check-service] port %BACKEND_PORT% is NOT listening.
) else (
  echo [check-service] port %BACKEND_PORT% is LISTENING.
)

exit /b 0
