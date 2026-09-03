<#
.SYNOPSIS
  Build the web frontend and copy dist/ into static_assets/web/ for Workers Assets bundling.
.DESCRIPTION
  1. cd ../web -> npx tsc -b -> npx vite build
  2. Purge server_cf/static_assets/web/
  3. Copy web/dist/* -> server_cf/static_assets/web/
  Used by deploy.ps1 and deploy_web.ps1. Does NOT deploy.
.PARAMETER SkipBuild
  Skip the tsc/vite build (use existing web/dist/)
.EXAMPLE
  pwsh -File scripts/build_web_assets.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Split-Path -Parent $scriptDir
$webDir = Join-Path (Split-Path -Parent $serverDir) "web"
$distDir = Join-Path $webDir "dist"
$assetsWebDir = Join-Path $serverDir "static_assets\web"

if (-not $SkipBuild) {
  Write-Host "[web] Build (tsc -b + vite build)..." -ForegroundColor Yellow
  Push-Location $webDir
  try {
    npx tsc -b 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "tsc -b failed (exit $LASTEXITCODE)" }
    npx vite build 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "vite build failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[web] Skipped build (using existing dist/)" -ForegroundColor Yellow
}

if (-not (Test-Path $distDir)) { throw "dist not found: $distDir" }

Write-Host "[web] Copying dist -> static_assets/web/ ..." -ForegroundColor Yellow
if (Test-Path $assetsWebDir) {
  Remove-Item -Recurse -Force $assetsWebDir
}
New-Item -ItemType Directory -Path $assetsWebDir -Force | Out-Null
Copy-Item -Path "$distDir\*" -Destination $assetsWebDir -Recurse -Force

$count = (Get-ChildItem $assetsWebDir -Recurse -File).Count
Write-Host "[web] Copied $count files into static_assets/web/" -ForegroundColor Green
