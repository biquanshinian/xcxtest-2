@echo off
chcp 65001 >nul
cd /d "%~dp0admin-web"
echo [admin-web] 监听模式：修改源码后自动 vite build → dist\
echo 按 Ctrl+C 结束
echo.
call npm run build:watch
