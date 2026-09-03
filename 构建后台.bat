@echo off
chcp 65001 >nul
cd /d "%~dp0admin-web"
echo [admin-web] 正在构建...
call npm run build
if errorlevel 1 (
  echo.
  echo 构建失败。
  if /i not "%~1"=="--nopause" pause
  exit /b 1
)
echo.
echo 构建完成：admin-web\dist\
if /i not "%~1"=="--nopause" pause
