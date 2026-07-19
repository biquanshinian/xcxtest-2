@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG=%~dp0logs\agent.log"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue |" ^
  " Where-Object { $_.CommandLine -and $_.CommandLine -like '*replay-fetcher*src\\index.js*' };" ^
  " if ($p) { exit 2 } else { exit 0 }"
if errorlevel 2 (
  echo [%date% %time%] already running>> "%LOG%"
  exit /b 0
)

where node >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: node not in PATH>> "%LOG%"
  exit /b 1
)

if not exist ".env" (
  echo [%date% %time%] ERROR: missing .env>> "%LOG%"
  exit /b 1
)

echo.>> "%LOG%"
echo [%date% %time%] agent start>> "%LOG%"
call npm start>> "%LOG%" 2>&1
echo [%date% %time%] agent exit code %ERRORLEVEL%>> "%LOG%"
exit /b %ERRORLEVEL%
