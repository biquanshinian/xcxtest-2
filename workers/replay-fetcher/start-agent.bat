@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG=%~dp0logs\agent.log"
set "LOCK=%~dp0logs\supervisor.lock"
set "SLOG=%~dp0logs\supervisor.log"
set "NODE_EXE="

if exist "%~dp0logs\node-path.txt" (
  set /p NODE_EXE=<"%~dp0logs\node-path.txt"
)
if not defined NODE_EXE (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
)
if not defined NODE_EXE (
  where node >nul 2>&1 && set "NODE_EXE=node"
)

powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0clear-stale-lock.ps1"

2>nul ( 9>"%LOCK%" call :main ) || (
  echo [%date% %time%] already running, supervisor exit>> "%SLOG%"
)
exit /b 0

:main
if not defined NODE_EXE (
  echo [%date% %time%] ERROR: node.exe not found>> "%LOG%"
  exit /b 1
)
if not exist ".env" (
  echo [%date% %time%] ERROR: missing .env>> "%LOG%"
  exit /b 1
)
if not exist "node_modules" (
  echo [%date% %time%] npm install...>> "%LOG%"
  call npm install>> "%LOG%" 2>&1
)

:loop
echo.>> "%LOG%"
echo [%date% %time%] agent start>> "%LOG%"
"%NODE_EXE%" "%~dp0src\index.js">> "%LOG%" 2>&1
echo [%date% %time%] agent exit code %ERRORLEVEL%, restart in 5s>> "%LOG%"
ping -n 6 127.0.0.1 >nul
goto loop
