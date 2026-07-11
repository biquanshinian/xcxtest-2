@echo off
setlocal EnableExtensions
set "TASK_NAME=BilibiliPublisherAgent"

echo Removing scheduled task: %TASK_NAME%
schtasks /Delete /TN "%TASK_NAME%" /F
if errorlevel 1 (
  echo Failed or task not found.
) else (
  echo Autostart removed.
)

echo.
echo To stop a running agent, end the related node.exe in Task Manager.
pause
