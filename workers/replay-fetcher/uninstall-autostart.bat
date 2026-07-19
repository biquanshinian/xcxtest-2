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

echo.
echo Autostart removed.
echo To stop a running agent, end the related node.exe in Task Manager.
pause
