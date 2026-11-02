@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

if not exist "%BACKEND%\.venv\Scripts\python.exe" (
  echo [ERROR] Backend venv not found.
  pause
  exit /b 1
)

if not exist "%FRONTEND%\package.json" (
  echo [ERROR] Frontend folder not found.
  pause
  exit /b 1
)

start "Aadi CRM Backend" "%BACKEND%\run-dev.bat"
start "Aadi CRM Frontend" "%FRONTEND%\run-dev.bat"

exit /b 0
