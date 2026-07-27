@echo off
setlocal
set "NINEROUTER_INSTALLER=%~f0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$source = Get-Content -Raw -LiteralPath $env:NINEROUTER_INSTALLER;" ^
  "$marker = '# POWERSHELL_INSTALLER';" ^
  "$offset = $source.LastIndexOf($marker);" ^
  "if ($offset -lt 0) { throw 'Embedded installer was not found.' };" ^
  "Invoke-Expression $source.Substring($offset + $marker.Length)"

exit /b %errorlevel%

# POWERSHELL_INSTALLER
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-9RouterPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $false
  }

  try {
    $resolved = [IO.Path]::GetFullPath(
      [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
    )
    $cliPath = Join-Path $resolved "cli.js"
    $packagePath = Join-Path $resolved "package.json"
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
      return $false
    }
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
      return $false
    }

    $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
    return $package.name -eq "9router"
  } catch {
    return $false
  }
}

function Find-9RouterPath {
  $candidates = [Collections.Generic.List[string]]::new()
  if ($env:NINEROUTER_HOME) {
    $candidates.Add($env:NINEROUTER_HOME)
  }

  try {
    $npmRoot = (& npm root -g 2>$null | Select-Object -First 1).Trim()
    if ($npmRoot) {
      $candidates.Add((Join-Path $npmRoot "9router"))
    }
  } catch {}

  if ($env:APPDATA) {
    $candidates.Add((Join-Path $env:APPDATA "npm\node_modules\9router"))
  }
  if ($env:ProgramFiles) {
    $candidates.Add((Join-Path $env:ProgramFiles "nodejs\node_modules\9router"))
  }

  try {
    foreach ($command in Get-Command 9router -All -ErrorAction SilentlyContinue) {
      $commandDir = Split-Path -Parent $command.Source
      if ($commandDir) {
        $candidates.Add((Join-Path $commandDir "node_modules\9router"))
      }
    }
  } catch {}

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-9RouterPath $candidate) {
      return [IO.Path]::GetFullPath(
        [Environment]::ExpandEnvironmentVariables($candidate.Trim().Trim('"'))
      )
    }
  }

  throw "Could not find the current 9Router installation. Set NINEROUTER_HOME to the directory containing cli.js and run again."
}

function Stop-9RouterProcesses([string]$TargetPath) {
  $targetCli = ([IO.Path]::GetFullPath((Join-Path $TargetPath "cli.js"))).ToLowerInvariant()
  $targetCliSlash = $targetCli.Replace("\", "/")

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $commandLine = [string]$_.CommandLine
      $normalized = $commandLine.ToLowerInvariant().Replace("\", "/")
      $normalized.Contains($targetCliSlash)
    } |
    ForEach-Object {
      Write-Host "Stopping running 9Router process $($_.ProcessId)..."
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 20.9 or newer first."
}
$nodeVersionText = (& node -p "process.versions.node" 2>$null).Trim()
$nodeVersion = [version]($nodeVersionText.Split("-")[0])
if ($nodeVersion -lt [version]"20.9.0") {
  throw "Node.js $nodeVersionText is too old. 9Router requires Node.js 20.9 or newer."
}

$repository = if ($env:NINEROUTER_REPO) {
  $env:NINEROUTER_REPO.Trim()
} else {
  "bonelag/9router"
}
if ($repository -notmatch "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") {
  throw "Invalid NINEROUTER_REPO: $repository"
}

$target = Find-9RouterPath
if ($target -in @(
  [IO.Path]::GetPathRoot($target),
  [Environment]::GetFolderPath("UserProfile"),
  $env:ProgramFiles
)) {
  throw "Refusing to replace unsafe target path: $target"
}

Write-Step "Current installation: $target"
Write-Step "Checking latest release from $repository"

$headers = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "9router-one-click-installer"
}
$release = Invoke-RestMethod `
  -Uri "https://api.github.com/repos/$repository/releases/latest" `
  -Headers $headers
$asset = $release.assets |
  Where-Object { $_.name -match "^9router_[0-9].*\.zip$" } |
  Select-Object -First 1
if (-not $asset) {
  throw "The latest release does not contain a 9router_<version>.zip asset."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) (
  "9router-update-" + [Guid]::NewGuid().ToString("N")
)
$archive = Join-Path $tempRoot $asset.name
$payload = Join-Path $tempRoot "payload"
$backup = Join-Path $tempRoot "backup"
$replacementStarted = $false

New-Item -ItemType Directory -Path $tempRoot, $payload, $backup -Force | Out-Null

try {
  Write-Step "Downloading $($asset.name)"
  Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $archive

  Write-Step "Validating downloaded package"
  Expand-Archive -LiteralPath $archive -DestinationPath $payload -Force
  if (-not (Test-9RouterPath $payload)) {
    throw "Downloaded ZIP is invalid: cli.js and a 9router package.json must be at the archive root."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $payload "node_modules") -PathType Container)) {
    throw "Downloaded ZIP is not portable: node_modules is missing."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $payload "app\server.js") -PathType Leaf)) {
    throw "Downloaded ZIP is incomplete: app\server.js is missing."
  }

  $newPackage = Get-Content -Raw -LiteralPath (Join-Path $payload "package.json") |
    ConvertFrom-Json
  Write-Step "Installing 9Router $($newPackage.version)"

  Stop-9RouterProcesses $target
  Get-ChildItem -LiteralPath $target -Force |
    Copy-Item -Destination $backup -Recurse -Force

  $replacementStarted = $true
  Get-ChildItem -LiteralPath $target -Force |
    Remove-Item -Recurse -Force
  Get-ChildItem -LiteralPath $payload -Force |
    Copy-Item -Destination $target -Recurse -Force

  & node (Join-Path $target "cli.js") --version
  if ($LASTEXITCODE -ne 0) {
    throw "The updated 9Router package failed its startup check."
  }

  Write-Host ""
  Write-Host "9Router $($newPackage.version) installed successfully." -ForegroundColor Green
  Write-Host "Location: $target"
} catch {
  if ($replacementStarted) {
    Write-Host "Update failed; restoring the previous installation..." -ForegroundColor Yellow
    Get-ChildItem -LiteralPath $target -Force -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $backup -Force -ErrorAction SilentlyContinue |
      Copy-Item -Destination $target -Recurse -Force
  }
  throw
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
