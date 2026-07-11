@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TASK_NAME=BilibiliPublisherAgent"
set "VBS=%~dp0start-agent-hidden.vbs"

if not exist "%VBS%" (
  echo [ERROR] Missing start-agent-hidden.vbs
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

if not exist "%~dp0.env" (
  echo [WARN] .env not found. Copy .env.example to .env and set BILI_AGENT_TOKEN.
  echo.
)

echo Registering scheduled task: %TASK_NAME%
schtasks /Create /TN "%TASK_NAME%" /TR "wscript.exe \"%VBS%\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
  echo.
  echo [ERROR] schtasks failed. Right-click this bat and Run as administrator.
  pause
  exit /b 1
)

echo.
echo OK. Task registered. Agent starts silently after Windows logon.
echo Log file: logs\agent.log
echo.
set /p RUNNOW=Run once now? [Y/N]: 
if /I "%RUNNOW%"=="Y" (
  echo Starting...
  wscript.exe "%VBS%"
  timeout /t 2 >nul
  echo Started. Check logs\agent.log
)

echo.
echo To remove autostart: run uninstall-autostart.bat
pause
