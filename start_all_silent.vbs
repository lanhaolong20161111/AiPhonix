' AiPhonix 开机自启启动器（后台静默运行，无命令行窗口）
' 通过 start_all.bat 拉起 后端(8080) + TS后端(3001) + 前端(5173)
Set ws = CreateObject("WScript.Shell")
batPath = "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\start_all.bat"
ws.Run "cmd /c """ & batPath & """", 0, False
