# 启动 AiPhonix 后端服务 (FastAPI, 端口 8080)
$ErrorActionPreference = "Continue"
$serverDir = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py"
$logFile = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\backend.log"
$errFile = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\backend.err"

# 若已在运行则跳过
$running = Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object {
    try { (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -match "main.py" } catch { $false }
}
if ($running) {
    Write-Host "backend already running (pid $($running[0].Id))"
    exit 0
}

Start-Process -FilePath "python" -ArgumentList "-u","main.py" -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile
Write-Host "backend started"
