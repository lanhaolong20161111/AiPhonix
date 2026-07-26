@echo off
setlocal
cd /d "%~dp0"
:: AiPhonix 服务端静默启动（无暂停，无弹窗）
start /B "" server.exe
