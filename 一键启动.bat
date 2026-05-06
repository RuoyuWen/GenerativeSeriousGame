@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title Generative Serious Game - 开发模式

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 npm。请先安装 Node.js 18^+：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
  )
)

call :free_port 8787
call :free_port 5173

rem 防止外部 PORT 环境变量影响后端（强制 8787）
set "PORT=8787"

echo.
echo 正在启动前端 + 后端...
echo   后端: http://127.0.0.1:8787
echo   前端: http://127.0.0.1:5173
echo   关闭本窗口即可停止。
echo.

call npm run dev
echo.
pause
exit /b %errorlevel%

:free_port
set "_PORT=%~1"
set "_FOUND="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%_PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    set "_FOUND=1"
    echo 端口 %_PORT% 被 PID %%P 占用，正在释放...
    taskkill /F /PID %%P >nul 2>nul
  )
)
if defined _FOUND (
  rem 给系统一点时间回收 socket
  ping -n 2 127.0.0.1 >nul
)
set "_PORT="
set "_FOUND="
exit /b 0
