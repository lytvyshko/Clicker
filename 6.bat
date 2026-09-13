@echo off
setlocal
mode con: cols=60 lines=12 >nul

:ask_total
set "total="
set /p "total=Enter total: "
if not defined total goto ask_total
for /f "delims=0123456789" %%A in ("%total%") do goto ask_total

:ask_mirages
set "mirages="
set /p "mirages=Enter mirages: "
if not defined mirages goto ask_mirages
for /f "delims=0123456789" %%A in ("%mirages%") do goto ask_mirages

cd /d "%~dp0"
node 6.js "%total%" "%mirages%"

pause
