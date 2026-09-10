@echo off
rem ============================================================
rem  AiPhonix Web 前端 (Vite dev server, 5173, HTTPS) autostart
rem  Robust for boot: absolute npm path + retry + port idempotency.
rem  Called by Task Scheduler "AiPhonix Web Frontend Autostart" (login trigger).
rem ============================================================
set "LOG=C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\web_frontend_start.log"
set "WEB=C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\web"
set "NPM=C:\Program Files\nodejs\npm.cmd"

cd /d "%WEB%"

echo [%date% %time%] AiPhonix web frontend autostart begin >> "%LOG%"

rem Idempotent: skip if port 5173 already listening (avoid duplicate Vite)
netstat -ano | findstr /c:":5173" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] web frontend already running on 5173, skip >> "%LOG%"
  exit /b 0
)

rem Launch with retries (npm/vite may be slow to come up at boot)
for /L %%i in (1,1,5) do (
  netstat -ano | findstr /c:":5173" | findstr /c:"LISTENING" >nul 2>&1
  if %errorlevel%==0 (
    echo [%date% %time%] web frontend already up after attempt %%i, exit >> "%LOG%"
    exit /b 0
  )
  echo [%date% %time%] attempt %%i: starting vite dev >> "%LOG%"
  "%NPM%" run dev >> "%LOG%" 2>&1
  timeout /t 8 /nobreak >nul 2>&1
)

echo [%date% %time%] web frontend gave up after 5 attempts >> "%LOG%"
