# AiPhonix watchdog: keeps TS backend (18002) and web frontend (5173) alive.
# Both start scripts are idempotent (skip if already running), so this loop just
# calls them every 30s; a crashed process is restarted within one cycle.
$ErrorActionPreference = "Continue"
$dir = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix"
Write-Host "[watchdog] started $(Get-Date -Format s)"
while ($true) {
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$dir\start_ts_backend.ps1" | Out-Null
    } catch {
        Write-Host "[watchdog] backend start error: $_"
    }
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$dir\start_frontend.ps1" | Out-Null
    } catch {
        Write-Host "[watchdog] frontend start error: $_"
    }
    Start-Sleep -Seconds 30
}
