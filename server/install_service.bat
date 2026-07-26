@echo off
:: 以管理员身份运行此脚本，创建 AiPhonixServer 任务计划
:: 开机自动启动，无需登录，后台无窗口运行

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
$action = New-ScheduledTaskAction -Execute \"%~dp0server.exe\" -WorkingDirectory \"%~dp0\"; ^
$trigger = New-ScheduledTaskTrigger -AtStartup; ^
$principal = New-ScheduledTaskPrincipal -UserId SYSTEM -LogonType ServiceAccount -RunLevel Highest; ^
Register-ScheduledTask -TaskName AiPhonixServer -Action $action -Trigger $trigger -Principal $principal -Description \"AiPhonix 服务端开机自启\"; ^
Write-Host 任务计划已创建!; ^
pause
