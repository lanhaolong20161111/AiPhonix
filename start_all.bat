@echo off
rem AiPhonix autostart: TS backend (8080) + Web frontend (5173). PY backend removed since 2026-08-24.
powershell -ExecutionPolicy Bypass -File "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\start_ts_backend.ps1"
powershell -ExecutionPolicy Bypass -File "c:\Users\lhl20\Desktop\android_cli_demos\AiPhonix\start_frontend.ps1"