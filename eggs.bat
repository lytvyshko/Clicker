@echo off
setlocal
mode con: cols=60 lines=12 >nul

cd /d "%~dp0"
node scripts\1.js

pause
