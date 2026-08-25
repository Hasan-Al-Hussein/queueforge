@echo off
setlocal
cd /d "%~dp0"
where pwsh >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local.ps1"
) else (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-local.ps1"
)
if errorlevel 1 (
  echo.
  echo QueueForge could not stop cleanly. Read the message above.
)
echo.
pause
