' AiPhonix 服务端隐藏启动器（无控制台窗口，供开机自启调用）
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c """ & "C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\start_server.bat" & """", 0, False
