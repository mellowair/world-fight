@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 后再启动。
  pause
  exit /b 1
)
node server.js --open
pause
endlocal
