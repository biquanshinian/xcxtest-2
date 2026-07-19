@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
set "LOG=%~dp0logs\agent.log"
set "LOCK=%~dp0logs\supervisor.lock"

rem Single-instance mutex: hold an exclusive handle on the lock file for the
rem whole supervisor lifetime. A second instance (any session: boot task,
rem startup vbs, manual run) fails to open it and exits. Works cross-session,
rem unlike process command-line matching.
2>nul ( 9>"%LOCK%" call :main ) || (
  echo [%date% %time%] already running, supervisor exit>> "%~dp0logs\supervisor.log"
)
exit /b 0

:main
where node >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: node not in PATH>> "%LOG%"
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

rem Supervisor loop: restart agent 15s after it exits (crash / killed).
:loop
echo.>> "%LOG%"
echo [%date% %time%] agent start>> "%LOG%"
node "%~dp0src\index.js">> "%LOG%" 2>&1
echo [%date% %time%] agent exit code %ERRORLEVEL%, restart in 15s>> "%LOG%"
ping -n 16 127.0.0.1 >nul
goto loop
