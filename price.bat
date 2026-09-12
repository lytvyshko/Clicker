@echo off
setlocal

set "price="
:ask_price
set /p "price=Enter price: "
if not defined price goto ask_price

cd /d "%~dp0"
node 0.js "%price%"

pause
