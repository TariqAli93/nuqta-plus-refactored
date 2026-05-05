@echo off
setlocal EnableExtensions
REM ============================================================================
REM  tools\bootstrap.bat   (packaged at %INSTDIR%\resources\tools\bootstrap.bat)
REM
REM  Production bootstrap for NuqtaPlus on Windows. Prepares everything the
REM  backend service expects to find before it starts:
REM
REM    1. PostgreSQL 18 is installed at the expected path
REM    2. nuqta_db database exists (created if missing)
REM    3. Drizzle migrations are applied
REM    4. NuqtaPlusBackend Windows Service is installed and running
REM    5. Backend port 41732 is listening
REM    6. Frontend desktop app is launched (skipped when called from the
REM       installer; set NUQTA_BOOTSTRAP_NO_LAUNCH=1)
REM
REM  Run as Administrator. The installer (NSIS customInstall) runs this
REM  automatically after copying files; it can also be re-run manually.
REM
REM  Edit the variables under "configuration" if your environment differs.
REM ============================================================================

REM ── configuration ───────────────────────────────────────────────────────────
set "PG_BIN=C:\Program Files\PostgreSQL\18\bin"
set "PG_HOST=localhost"
set "PG_PORT=5432"
set "PG_DATABASE=nuqta_db"
set "PG_USER=postgres"
set "PG_PASSWORD=root"
set "BACKEND_PORT=41732"
set "SVC_NAME=NuqtaPlusBackend"

REM Resolve install layout relative to this script.
REM   %~dp0          = ...\resources\tools\
REM   RESOURCES_DIR  = ...\resources
REM   INSTALL_DIR    = install root (one level above resources)
set "TOOLS_DIR=%~dp0"
for %%I in ("%TOOLS_DIR%..") do set "RESOURCES_DIR=%%~fI"
for %%I in ("%RESOURCES_DIR%\..") do set "INSTALL_DIR=%%~fI"
set "BACKEND_DIR=%RESOURCES_DIR%\backend"
set "SERVICE_DIR=%BACKEND_DIR%\service"
set "MIGRATIONS_DIR=%BACKEND_DIR%\migrations"
set "NODE_EXE=%BACKEND_DIR%\bin\node.exe"
set "MIGRATE_JS=%MIGRATIONS_DIR%\migrate-production.js"
set "FRONTEND_EXE=%INSTALL_DIR%\NuqtaPlus Server.exe"

REM ── elevation check ─────────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  echo [bootstrap] ERROR: must run as Administrator.
  exit /b 1
)

echo [bootstrap] checking PostgreSQL
if not exist "%PG_BIN%\psql.exe" (
  echo [bootstrap] ERROR: PostgreSQL not found at "%PG_BIN%".
  echo [bootstrap]        Install PostgreSQL 18 or edit PG_BIN at the top of this script.
  exit /b 1
)
if not exist "%PG_BIN%\createdb.exe" (
  echo [bootstrap] ERROR: createdb.exe not found at "%PG_BIN%".
  exit /b 1
)

set "PGPASSWORD=%PG_PASSWORD%"

echo [bootstrap] verifying connection to maintenance database
"%PG_BIN%\psql.exe" -h "%PG_HOST%" -p "%PG_PORT%" -U "%PG_USER%" -d postgres -c "SELECT 1" >nul 2>&1
if errorlevel 1 (
  echo [bootstrap] ERROR: cannot connect to PostgreSQL at %PG_HOST%:%PG_PORT% as user %PG_USER%.
  echo [bootstrap]        Check PostgreSQL is running and credentials are correct.
  set "PGPASSWORD="
  exit /b 1
)

echo [bootstrap] creating database if missing
REM createdb returns nonzero with "already exists" when the database is
REM present. Treat that as success; any other failure is fatal. This avoids
REM the cmd quoting issues that broke the prior `SELECT 1 FROM pg_database
REM WHERE datname='...'` probe (the `=` was being stripped during cmd
REM expansion inside `for /f "usebackq"`).
set "CREATEDB_ERR=%TEMP%\nuqta-bootstrap-createdb.err"
"%PG_BIN%\createdb.exe" -h "%PG_HOST%" -p "%PG_PORT%" -U "%PG_USER%" "%PG_DATABASE%" 2>"%CREATEDB_ERR%"
set "CREATEDB_EXIT=%errorlevel%"
if "%CREATEDB_EXIT%"=="0" (
  echo [bootstrap] database "%PG_DATABASE%" created.
) else (
  findstr /C:"already exists" "%CREATEDB_ERR%" >nul
  if errorlevel 1 (
    echo [bootstrap] ERROR: createdb failed:
    type "%CREATEDB_ERR%"
    del "%CREATEDB_ERR%" >nul 2>&1
    set "PGPASSWORD="
    exit /b 1
  )
  echo [bootstrap] database "%PG_DATABASE%" already exists.
)
del "%CREATEDB_ERR%" >nul 2>&1

REM Clear PGPASSWORD before invoking node so it isn't re-leaked further than
REM needed; the migrate script reads DATABASE_URL instead.
set "PGPASSWORD="

echo [bootstrap] running migrations
if not exist "%NODE_EXE%" (
  echo [bootstrap] ERROR: bundled Node not found at "%NODE_EXE%".
  exit /b 1
)
if not exist "%MIGRATE_JS%" (
  echo [bootstrap] ERROR: migration script not found at "%MIGRATE_JS%".
  exit /b 1
)
set "DATABASE_URL=postgresql://%PG_USER%:%PG_PASSWORD%@%PG_HOST%:%PG_PORT%/%PG_DATABASE%"
"%NODE_EXE%" "%MIGRATE_JS%"
set "MIGRATE_EXIT=%errorlevel%"
set "DATABASE_URL="
set "PG_PASSWORD="
if not "%MIGRATE_EXIT%"=="0" (
  echo [bootstrap] ERROR: migrations failed (exit %MIGRATE_EXIT%).
  exit /b 1
)

echo [bootstrap] installing backend service
sc.exe query "%SVC_NAME%" >nul 2>&1
if errorlevel 1 (
  call "%SERVICE_DIR%\install-service.bat"
  if errorlevel 1 (
    echo [bootstrap] ERROR: service install failed.
    exit /b 1
  )
) else (
  echo [bootstrap] %SVC_NAME% already installed.
)

echo [bootstrap] starting backend service
call "%SERVICE_DIR%\start-service.bat"
if errorlevel 1 (
  echo [bootstrap] ERROR: service did not start.
  exit /b 1
)

echo [bootstrap] verifying backend
sc.exe query "%SVC_NAME%" | findstr /C:"RUNNING" >nul
if errorlevel 1 (
  echo [bootstrap] ERROR: %SVC_NAME% is not in RUNNING state.
  exit /b 1
)

set /a _wait=0
:wait_port
netstat -ano -p TCP | findstr /R /C:":%BACKEND_PORT% .*LISTENING" >nul
if not errorlevel 1 goto port_ok
set /a _wait+=1
if %_wait% GEQ 30 (
  echo [bootstrap] ERROR: backend port %BACKEND_PORT% is not LISTENING after 30s.
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_port
:port_ok
echo [bootstrap] backend listening on port %BACKEND_PORT%.

if /I "%NUQTA_BOOTSTRAP_NO_LAUNCH%"=="1" (
  echo [bootstrap] skipping frontend launch (NUQTA_BOOTSTRAP_NO_LAUNCH=1).
) else (
  echo [bootstrap] starting frontend
  if exist "%FRONTEND_EXE%" (
    start "" "%FRONTEND_EXE%"
  ) else (
    echo [bootstrap] frontend executable not found at "%FRONTEND_EXE%" - skipping launch.
  )
)

echo [bootstrap] done
exit /b 0
