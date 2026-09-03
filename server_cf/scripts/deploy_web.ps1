<#
.SYNOPSIS
  Frontend-only deploy: build web, copy into static_assets/web, deploy Worker (bundles Assets), verify live.
.DESCRIPTION
  For pure frontend changes. Runs:
  1. scripts/build_web_assets.ps1  (tsc + vite build + copy dist -> static_assets/web)
  2. npx wrangler deploy           (ships Worker code + Assets together, atomically)
  3. verify live index.html + hashed assets
  NOTE: web assets now ship WITH the Worker via Workers Assets (no more R2 upload for /web).
.PARAMETER SkipBuild
  Skip the build step (re-copy existing dist/)
.EXAMPLE
  pwsh -File scripts/deploy_web.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Split-Path -Parent $scriptDir

Write-Host "`n=== AiPhonix Web Deploy (Workers Assets) ===" -ForegroundColor Cyan

# --- 1. Build + copy into assets ---
$buildScript = Join-Path $scriptDir "build_web_assets.ps1"
if ($SkipBuild) {
  & $buildScript -SkipBuild
} else {
  & $buildScript
}
if ($LASTEXITCODE -ne 0) { throw "build_web_assets.ps1 failed (exit $LASTEXITCODE)" }

# --- 2. Deploy Worker (bundles Assets) ---
Write-Host "[2/3] Deploy Worker (wrangler deploy)..." -ForegroundColor Yellow
Push-Location $serverDir
try {
  npx wrangler deploy 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
Write-Host "[2/3] Deployed`n" -ForegroundColor Green

# --- 3. Verify live ---
Write-Host "[3/3] Verify live site..." -ForegroundColor Yellow
$base = "https://aiphonix-api.xinyi7lan.workers.dev/web"
$rnd = Get-Random

$html = curl.exe -s --noproxy "*" "$base/?t=$rnd"
$jsRef = [regex]::Match($html, 'assets/index-[^"]+\.js').Value
$cssRef = [regex]::Match($html, 'assets/index-[^"]+\.css').Value
Write-Host "  index.html refs: $jsRef / $cssRef"

if (-not $jsRef) {
  Write-Host "  WARNING: no JS ref found - index.html may not have deployed" -ForegroundColor Red
} else {
  $jsCode = curl.exe -s --noproxy "*" -o NUL -w "%{http_code}" "$base/$jsRef"
  Write-Host "  $jsRef -> HTTP $jsCode"
  if ($jsCode -ne "200") { Write-Host "  WARNING: JS returned $jsCode" -ForegroundColor Red }
}
$swCode = curl.exe -s --noproxy "*" -o NUL -w "%{http_code}" "$base/sw.js?t=$rnd"
Write-Host "  sw.js -> HTTP $swCode"
Write-Host "[3/3] Verify done`n" -ForegroundColor Green

Write-Host "Done! Live refs: $jsRef / $cssRef" -ForegroundColor Green
Write-Host "  Tip: phone needs hard refresh (PWA SW updates precache)"
Write-Host ""
