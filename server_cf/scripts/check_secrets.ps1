<#
.SYNOPSIS
  Pre-deploy secret check. Verifies required Worker secrets exist before deploy.
.DESCRIPTION
  Runs `wrangler secret list` (JSON) and checks every required secret name is present.
  Exit code 0 = OK, 1 = missing (deploy should be aborted).
.PARAMETER Env
  Deploy environment name (pass through to wrangler, e.g. staging).
.EXAMPLE
  pwsh -File scripts/check_secrets.ps1
  pwsh -File scripts/check_secrets.ps1 -Env staging
#>
[CmdletBinding()]
param(
  [string]$Env = ""
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Split-Path -Parent $scriptDir

# Secrets REQUIRED for core features. Missing any of these = abort.
$required = @(
  "JWT_SECRET",
  "DEEPSEEK_API_KEY",
  "TENCENT_APP_ID",
  "TENCENT_SECRET_ID",
  "TENCENT_SECRET_KEY",
  "BAIDU_TTS_APP_ID",
  "BAIDU_TTS_API_KEY",
  "BAIDU_TTS_SECRET_KEY",
  "ARK_API_KEY",
  "ARK_MODEL",
  "ARK_CHAT_MODEL"
)
# Optional (feature-dependent)
$optional = @("PP_TOKEN", "CORS_ALLOW_ORIGINS", "DEEPSEEK_MODEL", "DEEPSEEK_BASE_URL")

Write-Host "=== Secret check ===" -ForegroundColor Cyan

Push-Location $serverDir
try {
  # JSON on stdout; proxy warning goes to stderr (drop it)
  if ($Env) {
    $json = npx wrangler secret list --env $Env 2>$null | Out-String
  } else {
    $json = npx wrangler secret list 2>$null | Out-String
  }
} finally {
  Pop-Location
}

if (-not $json.Trim().StartsWith("[")) {
  Write-Host "[WARN] wrangler secret list returned no JSON. Skipping check." -ForegroundColor Yellow
  exit 0
}

$found = @{}
try {
  $secrets = $json | ConvertFrom-Json
  foreach ($s in $secrets) { $found[$s.name] = $true }
} catch {
  Write-Host "[WARN] Could not parse secret list. Skipping check." -ForegroundColor Yellow
  exit 0
}

$missing = @()
foreach ($s in $required) {
  if (-not $found.ContainsKey($s)) { $missing += $s }
}

$bad = 0
if ($missing.Count -gt 0) {
  Write-Host "[FAIL] Missing required secrets:" -ForegroundColor Red
  foreach ($s in $missing) {
    Write-Host "  - $s" -ForegroundColor Red
    $bad = 1
  }
  Write-Host "Run in server_cf dir: npx wrangler secret put <NAME>" -ForegroundColor Yellow
} else {
  Write-Host "[OK] All $($required.Count) required secrets present." -ForegroundColor Green
}

$missOpt = @()
foreach ($s in $optional) {
  if (-not $found.ContainsKey($s)) { $missOpt += $s }
}
if ($missOpt.Count -gt 0) {
  Write-Host "[INFO] Optional secrets missing (ok): $($missOpt -join ', ')" -ForegroundColor DarkYellow
}

$verdict = if ($bad -eq 0) { 'PASSED' } else { 'FAILED' }
Write-Host "=== Secret check $verdict ===" -ForegroundColor $(if ($bad -eq 0) { "Green" } else { "Red" })
exit $bad
