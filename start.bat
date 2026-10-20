@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
set "URL=http://127.0.0.1:%PORT%/index.html"

rem Find a working Python. Each candidate is actually run, because "python" on Windows
rem is often the Microsoft Store placeholder, which exists but does not work.
set "PY="
py --version >nul 2>nul && set "PY=py"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY goto :nopython

rem If something is already listening on the port, just open the app.
netstat -ano | findstr /r /c:"127.0.0.1:%PORT% .*LISTENING" >nul
if %errorlevel%==0 goto :already

echo Starting server on %URL%
echo It stops by itself when the presentation page is closed. Close this window or press Ctrl+C to stop it sooner.
echo.

rem Open the browser after a short delay so the server is ready.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

rem Bound to localhost only, so it is not reachable from other machines.
%PY% server.py
goto :eof

:already
echo A server is already running on port %PORT%. Opening %URL%
start "" "%URL%"
timeout /t 3 >nul
goto :eof

:nopython
echo Python was not found.
echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
pause
