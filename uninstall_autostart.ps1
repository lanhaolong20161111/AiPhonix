# Remove AiPhonix autostart: delete the Startup folder shortcut
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "AiPhonix_AutoStart.lnk"

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Removed autostart shortcut: $shortcutPath"
} else {
    Write-Host "No autostart shortcut found, nothing to remove"
}
