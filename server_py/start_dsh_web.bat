@echo off
rem ============================================================
rem  dsh web (DeepSeek Harness GUI) autostart launcher
rem  Robust for boot-time: wait for network, retry npx a few times.
rem  Used by Task Scheduler "DSH Web Autostart" (login trigger).
rem ============================================================
set "LOG=C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\dsh_web_start.log"

rem ---- Working dir (npx needs a stable cwd; use install root area) ----
cd /d "C:\Users\lhl20\Desktop\android_cli_demos"

rem ---- Wait for network so the npx cache / registry is reachable ----
ping -n 1 127.0.0.1 >nul 2>&1
echo [%date% %time%] dsh web autostart begin >> "%LOG%"

rem ---- Idempotent: skip if port 3080 already listening ----
netstat -ano | findstr /c:":3080" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] dsh web already running on 3080, skip >> "%LOG%"
  exit /b 0
)

rem ---- Launch with retries (npx may need network to resolve the pkg) ----
for /L %%i in (1,1,5) do (
  netstat -ano | findstr /c:":3080" | findstr /c:"LISTENING" >nul 2>&1
  if %errorlevel%==0 (
    echo [%date% %time%] dsh web already up after attempt %%i, exit >> "%LOG%"
    exit /b 0
  )
  echo [%date% %time%] attempt %%i: starting dsh web >> "%LOG%"
  pushd "C:\Users\lhl20\Desktop\android_cli_demos"
  call "C:\Program Files\nodejs\npx.cmd" --yes @deepseek-ai/dsh web >> "%LOG%" 2>&1
  popd
  timeout /t 8 /nobreak >nul 2>&1
)

echo [%date% %time%] dsh web gave up after 5 attempts >> "%LOG%"
