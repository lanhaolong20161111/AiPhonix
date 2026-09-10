# Start AiPhonix TS backend (Hono, port 8080, production build)
# Replaces PY backend as the single server backend since 2026-08-24.
$ErrorActionPreference = "Continue"
$tsDir = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_ts"

# Skip if already running (match node dist/index.js, with or without server_ts path)
$running = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmd -match "dist[/\\]index\.js"
    } catch { $false }
}
if ($running) {
    Write-Host "ts_backend already running (pid $($running[0].Id))"
    exit 0
}

# Ensure production build exists (rebuild if dist missing)
if (-not (Test-Path "$tsDir\dist\index.js")) {
    Write-Host "ts_backend dist missing, building..."
    Push-Location $tsDir
    & npm run build 2>&1 | Write-Host
    Pop-Location
}

# Start node dist/index.js, hidden window.
# ASCII-only comments required here (Windows PowerShell reads no-BOM files as ANSI/GBK).
# PORT=18002: default config port 8080 is held by an unkillable legacy process;
#             Vite proxy targets 18002 since 2026-08-25.
$outLog = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_ts\ts_backend.log"
$errLog = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_ts\ts_backend.err.log"
$env:PORT = "18002"
Start-Process -FilePath "node" -ArgumentList "dist\index.js" -WorkingDirectory $tsDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Write-Host "ts_backend started (port 18002)"