# 启动 AiPhonix 前端服务 (Vite, 端口 5173)
$ErrorActionPreference = "Continue"
$webDir = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\web"

# 若已在运行则跳过
$running = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    try { (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -match "vite" } catch { $false }
}
if ($running) {
    Write-Host "frontend already running (pid $($running[0].Id))"
    exit 0
}

Start-Process -FilePath "npm" -ArgumentList "run","dev","--host" -WorkingDirectory $webDir -WindowStyle Hidden
Write-Host "frontend started"
