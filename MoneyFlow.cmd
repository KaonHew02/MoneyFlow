@echo off
title MoneyFlow
cd /d "%~dp0"
node server\server.js --open
echo.
echo MoneyFlow has stopped.
pause
