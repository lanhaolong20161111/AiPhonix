<#
.SYNOPSIS
  Staging one-time setup: push Worker secrets to --env staging, from shared/config.yaml.
.DESCRIPTION
  - Reads real key values from ../../shared/config.yaml (deepseek/baidu/tencent/ark/pp)
  - Generates a fresh stable JWT_SECRET (hex) for staging
  - Runs `wrangler secret put <NAME> --env staging` for each required secret (piped stdin)
  Requirement list mirrors scripts/check_secrets.ps1.
  ARK_MODEL / ARK_CHAT_MODEL: staging uses config/default values (satisfies required gate).
.EXAMPLE
  pwsh -File scripts/setup_staging.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Split-Path -Parent $scriptDir
$cfgPath = Join-Path (Split-Path -Parent $serverDir) "shared\config.yaml"

if (-not (Test-Path $cfgPath)) {
  Write-Host "[FAIL] shared/config.yaml not found: $cfgPath" -ForegroundColor Red
  exit 1
}

# ── 极简 YAML 解析：顶层 section + 缩进 key: value ──
$section = ""
$map = @{}
foreach ($line in (Get-Content $cfgPath)) {
  if ($line -match '^([A-Za-z0-9_]+):\s*(#.*)?$') {
    $section = $Matches[1]
  } elseif ($line -match '^\s+([A-Za-z0-9_]+):\s*"?(.*?)"?\s*(#.*)?$' -and $section) {
    $map["$section.$($Matches[1])"] = $Matches[2].Trim()
  }
}

function Get-Value($key) { if ($map.ContainsKey($key)) { $map[$key] } else { "" } }

# ── 生成 staging JWT_SECRET（64 hex，稳定跨请求）──
$jwt = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 64)

$secrets = [ordered]@{
  JWT_SECRET           = $jwt
  DEEPSEEK_API_KEY     = (Get-Value "deepseek.api_key")
  TENCENT_APP_ID       = (Get-Value "tencent.app_id")
  TENCENT_SECRET_ID    = (Get-Value "tencent.secret_id")
  TENCENT_SECRET_KEY   = (Get-Value "tencent.secret_key")
  BAIDU_TTS_APP_ID     = (Get-Value "baidu_tts.app_id")
  BAIDU_TTS_API_KEY    = (Get-Value "baidu_tts.api_key")
  BAIDU_TTS_SECRET_KEY = (Get-Value "baidu_tts.secret_key")
  ARK_API_KEY          = (Get-Value "ark_chat.api_key")
  ARK_MODEL            = "doubao-image-pro-32k"
  ARK_CHAT_MODEL       = "deepseek-v4-flash-ga-260731"
}

Write-Host "=== Staging secret setup (--env staging) ===" -ForegroundColor Cyan
Push-Location $serverDir
try {
  foreach ($name in $secrets.Keys) {
    $val = [string]$secrets[$name]
    if ([string]::IsNullOrWhiteSpace($val) -or $val -match '^YOUR_') {
      Write-Host "[SKIP] $name (no usable value in config.yaml)" -ForegroundColor Yellow
      continue
    }
    # 非交互：值经 stdin 管道喂给 wrangler secret put
    $val | npx wrangler secret put $name --env staging 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "[OK]   $name" -ForegroundColor Green }
    else { Write-Host "[FAIL] $name (exit $LASTEXITCODE)" -ForegroundColor Red }
  }
} finally {
  Pop-Location
}
Write-Host "=== Done. Run: & .\scripts\deploy.ps1 -Env staging ===" -ForegroundColor Green