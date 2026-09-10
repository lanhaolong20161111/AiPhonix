# Install AiPhonix autostart on user logon
# Puts a shortcut to start_all_silent.vbs into the user's Startup folder.
# Logs the user in -> silently launches backend(8080) + ts_backend(3001) + frontend(5173)

$vbsPath = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\start_all_silent.vbs"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "AiPhonix_AutoStart.lnk"

$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $vbsPath
$shortcut.WorkingDirectory = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix"
$shortcut.Description = "AiPhonix auto start"
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "Created autostart shortcut:"
Write-Host $shortcutPath

# Start once immediately (remove next line if you only want registration)
& "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\start_all.bat"
