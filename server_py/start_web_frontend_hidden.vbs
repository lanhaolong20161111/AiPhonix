' AiPhonix Web 前端隐藏启动器（无控制台窗口，供任务计划程序开机自启调用）
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c """ & "C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\start_web_frontend.bat" & """", 0, False
