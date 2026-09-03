<#
.SYNOPSIS
  One-command deploy: tsc gate -> secret check -> build web into Assets -> wrangler deploy -> verify.
.DESCRIPTION
  Single recommended deploy entry point for AiPhonix server_cf.
  The web frontend ships WITH the Worker via Workers Assets, so one deploy is atomic.
  Never run raw wrangler commands manually.
.PARAMETER SkipWeb
  Skip web build+copy (deploy Worker code + existing assets only)
.PARAMETER SkipSecrets
  Skip the pre-deploy secret check
.PARAMETER Env
  Deploy environment (empty = prod; "staging" = aiphonix-api-staging + staging D1/R2)
.EXAMPLE
  pwsh -File scripts/deploy.ps1              # full deploy (worker + web assets)
  pwsh -File scripts/deploy.ps1 -SkipWeb     # worker code only, keep existing assets
  pwsh -File scripts/deploy.ps1 -Env staging # deploy to staging (改代码先验证，不打线上)
  pwsh -File scripts/deploy_web.ps1          # frontend-only deploy
#>
[CmdletBinding()]
param(
  [switch]$SkipWeb,
  [switch]$SkipSecrets,
  [string]$Env = ""
)

# NOTE: do NOT set ErrorActionPreference=Stop here. Native commands (npx/wrangler)
# write proxy warnings to stderr, and "Stop" turns those into terminating errors.
# We rely on explicit $LASTEXITCODE checks instead.
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Split-Path -Parent $scriptDir

$envFlag = ""
if ($Env) { $envFlag = "--env $Env" }
$label = if ($Env) { $Env } else { "prod" }
$verifyBase = if ($Env) { "https://aiphonix-api-$Env.xinyi7lan.workers.dev/web" } else { "https://aiphonix-api.xinyi7lan.workers.dev/web" }

Write-Host "`n=== AiPhonix Full Deploy ($label) ===" -ForegroundColor Cyan

# --- 0. Type check gate ---
Write-Host "[0/4] TypeScript type check (tsc --noEmit)..." -ForegroundColor Yellow
Push-Location $serverDir
try {
  npx tsc --noEmit 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FAIL] tsc type check failed. Deploy aborted." -ForegroundColor Red
    Write-Host "Fix type errors and retry." -ForegroundColor Red
    exit 1
  }
} finally {
  Pop-Location
}
Write-Host "[0/4] Type check passed`n" -ForegroundColor Green

# --- 0.5 Secret check gate ---
if (-not $SkipSecrets) {
  Write-Host "[0.5/4] Pre-deploy secret check..." -ForegroundColor Yellow
  $secretScript = Join-Path $scriptDir "check_secrets.ps1"
  if ($Env) { & $secretScript -Env $Env } else { & $secretScript }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FAIL] Missing required secrets. Deploy aborted." -ForegroundColor Red
    Write-Host "Set them first (see above). Retry after fixing." -ForegroundColor Red
    exit 1
  }
  Write-Host "[0.5/4] Secret check passed`n" -ForegroundColor Green
} else {
  Write-Host "[0.5/4] Skipped secret check`n" -ForegroundColor Yellow
}

# --- 1. Build web + copy into static_assets ---
if (-not $SkipWeb) {
  Write-Host "[1/4] Build web into static_assets..." -ForegroundColor Yellow
  $buildScript = Join-Path $scriptDir "build_web_assets.ps1"
  & $buildScript
  if ($LASTEXITCODE -ne 0) { throw "build_web_assets.ps1 failed (exit $LASTEXITCODE)" }
  Write-Host "[1/4] Web assets ready`n" -ForegroundColor Green
} else {
  Write-Host "[1/4] Skipped web build (existing assets)`n" -ForegroundColor Yellow
}

# --- 2. Deploy Worker (bundles Assets) ---
Write-Host "[2/4] Deploy Worker (wrangler deploy $envFlag)..." -ForegroundColor Yellow
Push-Location $serverDir
try {
  if ($Env) { npx wrangler deploy --env $Env 2>&1 | Out-Host }
  else { npx wrangler deploy 2>&1 | Out-Host }
  if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
Write-Host "[2/4] Worker deployed`n" -ForegroundColor Green

# --- 3. Verify live ---
if (-not $SkipWeb) {
  Write-Host "[3/4] Verify live site..." -ForegroundColor Yellow
  $base = $verifyBase
  $rnd = Get-Random
  $html = curl.exe -s --noproxy "*" "$base/?t=$rnd"
  $jsRef = [regex]::Match($html, 'assets/index-[^"]+\.js').Value
  $cssRef = [regex]::Match($html, 'assets/index-[^"]+\.css').Value
  Write-Host "  index.html refs: $jsRef / $cssRef"
  if ($jsRef) {
    $jsCode = curl.exe -s --noproxy "*" -o NUL -w "%{http_code}" "$base/$jsRef"
    Write-Host "  $jsRef -> HTTP $jsCode"
    if ($jsCode -ne "200") { Write-Host "  WARNING: JS returned $jsCode" -ForegroundColor Red }
  } else {
    Write-Host "  WARNING: no JS ref found" -ForegroundColor Red
  }
  $swCode = curl.exe -s --noproxy "*" -o NUL -w "%{http_code}" "$base/sw.js?t=$rnd"
  Write-Host "  sw.js -> HTTP $swCode"
  Write-Host "[3/4] Verify done`n" -ForegroundColor Green
}

# --- 4. Done ---
Write-Host "[4/4] All done!" -ForegroundColor Green
Write-Host "  Worker: deployed (tsc+secrets gated) [$label]"
if ($Env) { Write-Host "  URL: https://aiphonix-api-$Env.xinyi7lan.workers.dev" }
Write-Host "  Web:   $(if ($SkipWeb) { 'skipped (existing assets)' } else { 'built+deployed+verified' })"
Write-Host "  Tip: phone needs hard refresh (PWA SW auto-updates precache)"
Write-Host ""
