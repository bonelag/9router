@echo off
REM ============================================================
REM  9Router - build & run on Windows
REM  Everything (compiled app, data/DB, logs) lands under .\build
REM  Server listens on http://localhost:2018
REM
REM  Usage:
REM    build.bat          install (if needed) + build + run (next start)
REM    build.bat run      skip build, run existing build (next start)
REM    build.bat build    build only, don't start the server
REM    build.bat bun      run the standalone server with bun
REM                       (copies public/ + static/ into standalone first,
REM                        otherwise provider icons 404 — standalone never
REM                        bundles public/ or .next/static on its own)
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "ROOT=%CD%"
set "BUILD=%ROOT%\build"

REM ---- route data + logs into .\build (build output stays in .next
REM      so `bun .next\standalone\server.js` and `next start` both work) ----
set "DATA_DIR=%BUILD%\data"
set "NEXT_TELEMETRY_DISABLED=1"
set "ENABLE_REQUEST_LOGS=true"
set "HOSTNAME=0.0.0.0"
set "BASE_URL=http://localhost:2018"
set "CLOUD_URL=https://9router.com"
set "NEXT_PUBLIC_BASE_URL=http://localhost:2018"
set "NEXT_PUBLIC_CLOUD_URL=https://9router.com"

if not exist "%BUILD%\data" mkdir "%BUILD%\data"
if not exist "%BUILD%\logs" mkdir "%BUILD%\logs"

REM requestLogger writes to <cwd>\logs; junction it into build\logs (no admin needed)
if not exist "%ROOT%\logs" mklink /J "%ROOT%\logs" "%BUILD%\logs" >nul 2>&1

set "MODE=%~1"

if /i "%MODE%"=="run" goto :run
if /i "%MODE%"=="bun" goto :bun

REM ---- install deps (only if missing) --------------------------------
if not exist "%ROOT%\node_modules" (
  echo [1/3] Installing dependencies...
  call npm install || goto :fail
) else (
  echo [1/3] Dependencies present, skipping npm install.
)

REM ---- build ---------------------------------------------------------
echo [2/3] Building (output in .next) ...
set "NODE_OPTIONS=--require %ROOT%\scripts\patch-build.js"
call npm run build || goto :fail

if /i "%MODE%"=="build" (
  echo Build complete. Output in "%ROOT%\.next".
  goto :done
)

:run
REM ---- start ---------------------------------------------------------
set "NODE_ENV=production"
echo [3/3] Starting 9Router on http://localhost:2018
echo         data: %DATA_DIR%
echo         logs: %BUILD%\logs
call npm run start -- -p 2018 -H 0.0.0.0
goto :done

:bun
REM ---- run the standalone server with bun ----------------------------
REM standalone output never contains public/ or .next/static — copy them in
REM next to server.js, exactly like the Dockerfile does, or icons 404.
set "STANDALONE=%ROOT%\.next\standalone"
if not exist "%STANDALONE%\server.js" (
  echo No standalone build found at "%STANDALONE%".
  echo Run "build.bat build" first.
  goto :fail
)
echo Staging public\ and .next\static into standalone ...
xcopy /E /I /Y /Q "%ROOT%\public" "%STANDALONE%\public" >nul
xcopy /E /I /Y /Q "%ROOT%\.next\static" "%STANDALONE%\.next\static" >nul
set "NODE_ENV=production"
set "PORT=2018"
echo Starting standalone (bun) on http://localhost:2018
echo         data: %DATA_DIR%
echo         logs: %BUILD%\logs
call bun "%STANDALONE%\server.js"
goto :done

:fail
echo.
echo BUILD FAILED. See output above.
exit /b 1

:done
endlocal
