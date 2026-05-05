@echo off
setlocal EnableExtensions
REM ============================================================================
REM  tools\check-database.bat
REM
REM  Diagnoses the PostgreSQL connection used by NuqtaPlus:
REM    - psql is reachable at PG_BIN
REM    - maintenance database "postgres" accepts the configured credentials
REM    - target database nuqta_db exists
REM ============================================================================

set "PG_BIN=C:\Program Files\PostgreSQL\18\bin"
set "PG_HOST=localhost"
set "PG_PORT=5432"
set "PG_DATABASE=nuqta_db"
set "PG_USER=postgres"
set "PG_PASSWORD=root"

if not exist "%PG_BIN%\psql.exe" (
  echo [check-database] ERROR: psql not found at "%PG_BIN%".
  exit /b 1
)

set "PGPASSWORD=%PG_PASSWORD%"

echo [check-database] testing connection to maintenance database
"%PG_BIN%\psql.exe" -h "%PG_HOST%" -p "%PG_PORT%" -U "%PG_USER%" -d postgres -tAc "SELECT version()"
if errorlevel 1 (
  echo [check-database] ERROR: cannot connect as %PG_USER%@%PG_HOST%:%PG_PORT%.
  set "PGPASSWORD="
  exit /b 1
)

echo.
echo [check-database] checking database "%PG_DATABASE%"
for /f "usebackq delims=" %%R in (`""%PG_BIN%\psql.exe" -h "%PG_HOST%" -p "%PG_PORT%" -U "%PG_USER%" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='%PG_DATABASE%'""`) do set "DB_EXISTS=%%R"
if "%DB_EXISTS%"=="1" (
  echo [check-database] database "%PG_DATABASE%" exists.
) else (
  echo [check-database] database "%PG_DATABASE%" does NOT exist.
)

set "PGPASSWORD="
exit /b 0
