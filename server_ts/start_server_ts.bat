@echo off
rem ============================================================
rem  AiPhonix backend (TS / Hono) launcher
rem  Replaces the Python backend on port 8080.
rem  Python backend kept intact for rollback (start_server.bat).
rem ============================================================
set "ROOT=C:\Users\lhl20\Desktop\android_cli_demos\AiPhonix"
set "LOG=%ROOT%\server_ts\server_ts_start.log"
set "NODE=node"

echo [%date% %time%] AiPhonix TS server autostart begin >> "%LOG%"

cd /d "%ROOT%\server_ts"

rem --- 1. Kill any existing Python backend on 8080 (stop old server first) ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":8080" ^| findstr /c:"LISTENING"') do (
  echo [%date% %time%] stopping process on 8080: PID %%p >> "%LOG%"
  taskkill /PID %%p /F >> "%LOG%" 2>&1
)
timeout /t 2 /nobreak >nul

rem --- 2. Idempotent: skip if port 8080 already LISTENING (after kill, avoid dup) ---
netstat -ano | findstr /c:":8080" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo [%date% %time%] port 8080 already listening, skip >> "%LOG%"
  exit /b 0
)

rem --- 3. Launch TS backend (no reload, stable) ---
start "AiPhonix TS Server" /min cmd /c "cd /d "%ROOT%\server_ts" && "%NODE%" --import tsx src/index.ts >> "%ROOT%\server_ts\server_ts.log" 2>&1"

echo [%date% %time%] TS server launched (port 8080) >> "%LOG%"
