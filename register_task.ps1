# Run as Administrator. Registers a system-level startup task (no login needed).
$ErrorActionPreference = "Stop"
$bat = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\start_all.bat"

$action = New-ScheduledTaskAction -Execute $bat
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "AiPhonixServices" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Select-Object TaskName, State, @{N="Principal";E={$_.Principal.UserId}}

Write-Host "System task registered: starts at boot (no login required)"
