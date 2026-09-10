# AiPhonix prod secret recovery from shared/config.yaml + .dev.vars (2026-09-03)
# Run: powershell -NoProfile -File restore_prod_secrets.ps1
[CmdletBinding()]
param()
$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $scriptDir ".."
$cfgPath = Join-Path $serverDir "..\shared\config.yaml"

Write-Host "=== Prod secret recovery ===" -ForegroundColor Cyan

# ---- minimal YAML parse ----
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

# ---- build secret map ----
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
  ARK_CHAT_MODEL       = (Get-Value "ark_chat.model")
  ARK_MODEL            = "doubao-image-pro-32k"
  PADDLE_OCR_TOKEN     = (Get-Value "pp_structure.token")
}

Push-Location $serverDir
try {
  foreach ($name in $secrets.Keys) {
    $val = [string]$secrets[$name]
    if ([string]::IsNullOrWhiteSpace($val) -or $val -match '^YOUR_') {
      Write-Host "[SKIP] $name (no usable value)" -ForegroundColor Yellow
      continue
    }
    $val | npx wrangler secret put $name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "[OK]   $name" -ForegroundColor Green }
    else { Write-Host "[FAIL] $name (exit $LASTEXITCODE)" -ForegroundColor Red }
  }
} finally {
  Pop-Location
}
Write-Host "=== Done. BIGMODEL_API_KEY pending user input. ===" -ForegroundColor Green
