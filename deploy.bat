@echo off
setlocal enabledelayedexpansion

title Deploy 9Router to node22

echo ======================================================================
echo              9Router - Build and Deploy to node22
echo ======================================================================
echo.

set "ROOT_DIR=%~dp0"
set "CLI_DIR=%ROOT_DIR%cli"
set "TARGET_DIR=C:\DEV\node22\node_modules\9router"

:: 1. Verify environment
echo [*] Checking build environment...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] node is not found in PATH. Please ensure Node.js is installed.
    exit /b 1
)

where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not found in PATH.
    exit /b 1
)

if not exist "%TARGET_DIR%" (
    echo [*] Creating target directory: %TARGET_DIR%
    mkdir "%TARGET_DIR%" 2>nul
)

:: 2. Check and stop running 9router processes to avoid file lock issues
echo [*] Checking for active 9router processes on port 20128...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 20128 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 3. Execute full production build
echo.
echo ======================================================================
echo  [1/3] Building Next.js standalone and CLI package...
echo ======================================================================
echo.

call node "%CLI_DIR%\scripts\build-cli.js"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build step failed with exit code %ERRORLEVEL%.
    exit /b %ERRORLEVEL%
)

:: 4. Sync files to target directory using robocopy
echo.
echo ======================================================================
echo  [2/3] Syncing files to %TARGET_DIR%...
echo ======================================================================
echo.

set "HAS_SYNC_ERROR=0"

:: 4.1 Sync app (standalone Next.js runtime + built assets)
echo  - Syncing app directory...
robocopy "%CLI_DIR%\app" "%TARGET_DIR%\app" /MIR /FFT /R:2 /W:1 /NP /NDL /NFL
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Failed to sync app directory. Robocopy code: %ERRORLEVEL%
    set "HAS_SYNC_ERROR=1"
)

:: 4.2 Sync cli src directory
echo  - Syncing src directory...
robocopy "%CLI_DIR%\src" "%TARGET_DIR%\src" /MIR /FFT /R:2 /W:1 /NP /NDL /NFL
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Failed to sync src directory. Robocopy code: %ERRORLEVEL%
    set "HAS_SYNC_ERROR=1"
)

:: 4.3 Sync cli hooks directory
echo  - Syncing hooks directory...
robocopy "%CLI_DIR%\hooks" "%TARGET_DIR%\hooks" /MIR /FFT /R:2 /W:1 /NP /NDL /NFL
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Failed to sync hooks directory. Robocopy code: %ERRORLEVEL%
    set "HAS_SYNC_ERROR=1"
)

:: 4.4 Copy root CLI files
echo  - Copying CLI launcher and metadata files...
robocopy "%CLI_DIR%" "%TARGET_DIR%" cli.js package.json README.md LICENSE /R:2 /W:1 /NP /NDL /NFL
if %ERRORLEVEL% GEQ 8 (
    echo [ERROR] Failed to copy CLI launcher files. Robocopy code: %ERRORLEVEL%
    set "HAS_SYNC_ERROR=1"
)

:: 4.5 Sync node_modules dependencies (excluding build/dev tools)
if exist "%CLI_DIR%\node_modules" (
    echo  - Syncing CLI node_modules...
    robocopy "%CLI_DIR%\node_modules" "%TARGET_DIR%\node_modules" /E /XD .bin esbuild @esbuild nodemon chokidar /R:2 /W:1 /NP /NDL /NFL
    if %ERRORLEVEL% GEQ 8 (
        echo [ERROR] Failed to sync node_modules. Robocopy code: %ERRORLEVEL%
        set "HAS_SYNC_ERROR=1"
    )
)

if "%HAS_SYNC_ERROR%"=="1" (
    echo.
    echo [ERROR] One or more sync operations failed!
    exit /b 1
)

:: 5. Verification: ensure critical artifacts are present
echo.
echo ======================================================================
echo  [3/3] Verifying deployment integrity...
echo ======================================================================
echo.

set "VERIFY_FAILED=0"

for %%F in (
    "%TARGET_DIR%\cli.js"
    "%TARGET_DIR%\package.json"
    "%TARGET_DIR%\app\server.js"
    "%TARGET_DIR%\app\custom-server.js"
    "%TARGET_DIR%\app\.next-cli-build\server\app\api\v1\models\route.js"
    "%TARGET_DIR%\app\.next-cli-build\server\app\api\v1\chat\completions\route.js"
) do (
    if not exist %%F (
        echo [MISSING] %%~F
        set "VERIFY_FAILED=1"
    ) else (
        echo [OK] %%~nxF
    )
)

if "%VERIFY_FAILED%"=="1" (
    echo.
    echo [ERROR] Verification failed! One or more critical files are missing in %TARGET_DIR%.
    exit /b 1
)

echo.
echo ======================================================================
echo  SUCCESS: 9Router has been built and deployed successfully!
echo  Target: %TARGET_DIR%
echo ======================================================================
echo.

exit /b 0
