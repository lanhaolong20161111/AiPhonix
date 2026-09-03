' AiPhonix Web (Vite dev) 隐藏启动器（无控制台窗口，供开机自启 / 手动调用）
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c """ & "C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\web\start_web.bat" & """", 0, False
