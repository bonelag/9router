@echo off
REM ============================================================
REM  9Router - build & run on Windows
REM  Server listens on http://localhost:2018
REM
REM  Usage:
REM    build.bat          build CLI & Next.js + copy to product (default)
REM    build.bat run      skip build, run existing build (next start)
REM    build.bat build    build Next.js app only, don't start the server
REM    build.bat bun      run the standalone server with bun
REM                       (copies public/ + static/ into standalone first,
REM                        otherwise provider icons 404 — standalone never
REM                        bundles public/ or .next/static on its own)
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "ROOT=%CD%"

set "NEXT_TELEMETRY_DISABLED=1"
set "ENABLE_REQUEST_LOGS=true"
set "HOSTNAME=0.0.0.0"
set "BASE_URL=http://localhost:2018"
set "CLOUD_URL=https://9router.com"
set "NEXT_PUBLIC_BASE_URL=http://localhost:2018"
set "NEXT_PUBLIC_CLOUD_URL=https://9router.com"

set "MODE=%~1"

if "%MODE%"==" " set "MODE="
if "%MODE%"=="" goto :default
if /i "%MODE%"=="run" goto :run
if /i "%MODE%"=="bun" goto :bun
if /i "%MODE%"=="build" goto :build

:default
REM ---- install deps (only if missing) --------------------------------
if not exist "%ROOT%\node_modules" (
  echo [1/3] Installing dependencies...
  call npm install || goto :fail
)
if not exist "%ROOT%\cli\node_modules" (
  echo [2/3] Installing CLI dependencies...
  call npm --prefix cli install || goto :fail
)

REM ---- build CLI -----------------------------------------------------
echo [3/3] Building CLI package...
call npm --prefix cli run build || goto :fail

REM ---- copy to product -----------------------------------------------
echo Copying built files to product/ directory...
if not exist "%ROOT%\product" mkdir "%ROOT%\product"
powershell -Command "Remove-Item -Recurse -Force '%ROOT%\product\*' -ErrorAction SilentlyContinue; Copy-Item -Path '%ROOT%\cli\cli.js', '%ROOT%\cli\package.json', '%ROOT%\cli\README.md', '%ROOT%\cli\LICENSE' -Destination '%ROOT%\product\' -Force; Copy-Item -Path '%ROOT%\cli\src', '%ROOT%\cli\hooks', '%ROOT%\cli\app' -Destination '%ROOT%\product\' -Recurse -Container -Force" || goto :fail

echo.
echo CLI package successfully built and copied to "%ROOT%\product".
goto :done

:build
REM ---- install deps (only if missing) --------------------------------
if not exist "%ROOT%\node_modules" (
  echo [1/3] Installing dependencies...
  call npm install || goto :fail
)
REM ---- build Next.js only ---------------------------------------------
echo [2/3] Building Next.js app only...
set "NODE_OPTIONS=--require %ROOT%\scripts\patch-build.js"
call npm run build || goto :fail
echo Build complete. Output in "%ROOT%\.next".
goto :done

:run
REM ---- start ---------------------------------------------------------
if not exist "%ROOT%\product\cli.js" (
  echo Product build not found in "%ROOT%\product".
  echo Please run "build.bat" first to build the product.
  goto :fail
)
set "NODE_ENV=production"
echo [3/3] Starting 9Router CLI from "%ROOT%\product\cli.js"...
cd /d "%ROOT%\product"
call node cli.js --port 2018 --host 0.0.0.0 --skip-update
cd /d "%ROOT%"
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
call bun "%STANDALONE%\server.js"
goto :done

:fail
echo.
echo BUILD FAILED. See output above.
exit /b 1

:done
endlocal
