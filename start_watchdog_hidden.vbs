' AiPhonix watchdog hidden launcher (place a copy in shell:startup)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\watchdog_all.ps1""", 0, False
