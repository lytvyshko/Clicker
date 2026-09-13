@echo off
setlocal
mode con: cols=60 lines=12 >nul

cd /d "%~dp0"
node 1.js

pause
