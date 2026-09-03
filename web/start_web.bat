@echo off
rem AiPhonix web dev server (Vite) - hidden autostart helper
cd /d C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\web

rem Idempotent: skip if port 5173 already listening
rem NOTE: literal findstr (not regex) - regex ":5173 .*LISTENING" wrongly
rem matches any LISTENING line, causing false "already running".
netstat -ano | findstr /c:":5173" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] web dev server already running on 5173, skip >> vite_start.log
  exit /b 0
)

call npm run dev > vite.log 2>&1
