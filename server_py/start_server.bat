@echo off
rem ============================================================
rem  AiPhonix backend (uvicorn) autostart launcher
rem  Robust for boot: absolute python path + retry loop.
rem  Called by Task Scheduler "AiPhonix Server Autostart" (login trigger)
rem  and manually by double-click / the old startup-folder .lnk.
rem ============================================================
set "LOG=C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py\server_start.log"
set "PY=C:\Python314\python.exe"

cd /d C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\server_py

echo [%date% %time%] AiPhonix server autostart begin >> "%LOG%"

rem Idempotent: skip if port 8080 already listening (avoid duplicate instance)
rem NOTE: use literal findstr (not regex) - regex ":8080 .*LISTENING" wrongly
rem matches any LISTENING line and TIME_WAIT rows, causing false "already running".
netstat -ano | findstr /c:":8080" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] server already running on 8080, skip >> "%LOG%"
  exit /b 0
)

rem Launch with retries (python may be slow to become healthy at boot)
for /L %%i in (1,1,5) do (
  netstat -ano | findstr /c:":8080" | findstr /c:"LISTENING" >nul 2>&1
  if %errorlevel%==0 (
    echo [%date% %time%] server already up after attempt %%i, exit >> "%LOG%"
    exit /b 0
  )
  echo [%date% %time%] attempt %%i: starting uvicorn >> "%LOG%"
  "%PY%" -X utf8 -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload >> server.log 2>&1
)

echo [%date% %time%] server gave up after 5 attempts >> "%LOG%"
