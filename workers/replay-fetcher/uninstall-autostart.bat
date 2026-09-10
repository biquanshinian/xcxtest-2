@echo off
setlocal EnableExtensions

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK_VBS=%STARTUP%\ReplayFetcherAgent.vbs"

echo Removing Startup launcher if present...
if exist "%LINK_VBS%" (
  del /F /Q "%LINK_VBS%"
  echo Removed: %LINK_VBS%
) else (
  echo Startup launcher not found - skip.
)

echo Removing watchdog scheduled task if present...
schtasks /Delete /TN "ReplayFetcherWatchdog" /F >nul 2>&1
if errorlevel 1 (
  echo Watchdog task not found - skip.
) else (
  echo Removed scheduled task: ReplayFetcherWatchdog
)

echo.
echo Autostart removed.
echo To stop a running agent, end the related node.exe in Task Manager.
if /I not "%~1"=="-NoPause" pause
