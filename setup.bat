@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "H3_EXIT=%ERRORLEVEL%"
if not "%H3_EXIT%"=="0" echo H3 setup failed. See the error above.
if "%~1"=="" pause
exit /b %H3_EXIT%
