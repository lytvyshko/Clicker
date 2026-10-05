@echo off
setlocal
mode con: cols=60 lines=12 >nul

cd /d "%~dp0"
node shao_hao.js

pause
