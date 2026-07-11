@echo off
setlocal EnableExtensions

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK_CMD=%STARTUP%\BilibiliPublisherAgent.cmd"
set "LINK_VBS=%STARTUP%\BilibiliPublisherAgent.vbs"
set "TASK_NAME=BilibiliPublisherAgent"

echo Removing Startup launcher if present...
if exist "%LINK_CMD%" (
  del /F /Q "%LINK_CMD%"
  echo Removed: %LINK_CMD%
) else (
  echo Startup .cmd not found - skip.
)
if exist "%LINK_VBS%" (
  del /F /Q "%LINK_VBS%"
  echo Removed: %LINK_VBS%
)

echo Removing old scheduled task if present...
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
if errorlevel 1 (
  echo Scheduled task not found - skip.
) else (
  echo Removed scheduled task: %TASK_NAME%
)

echo.
echo Autostart removed.
echo To stop a running agent, end the related node.exe in Task Manager.
pause
