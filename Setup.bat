@echo off
setlocal EnableExtensions
title GA PDF Editor - Setup
cd /d "%~dp0"

echo.
echo  GA PDF Editor - one-time setup
echo  ==============================
echo  Downloads libraries and fonts (network required once).
echo.

rem Shipped zip: tools\setup.ps1   |   this repo: tools\package\setup.ps1
set "SETUP_PS1="
if exist "%~dp0tools\setup.ps1" set "SETUP_PS1=%~dp0tools\setup.ps1"
if not defined SETUP_PS1 if exist "%~dp0tools\package\setup.ps1" set "SETUP_PS1=%~dp0tools\package\setup.ps1"

if not defined SETUP_PS1 (
  echo ERROR: setup.ps1 not found.
  echo Expected tools\setup.ps1 next to this file ^(after unzipping the package^).
  echo.
  pause
  exit /b 1
)

rem Bypass execution policy for this run only; no admin required.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SETUP_PS1%" %*
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo Setup finished with errors ^(exit code %ERR%^).
  echo See messages above, or tools\SETUP.md for details.
  echo.
  pause
  exit /b %ERR%
)

echo Setup finished successfully.
echo You can close this window, then open "Open GA PDF Editor.url".
echo.
pause
exit /b 0
