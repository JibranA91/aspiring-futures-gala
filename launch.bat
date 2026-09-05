@echo off
title Aspiring Futures - Gala Display  (keep this window open)
cd /d "%~dp0gala"
echo.
echo   Aspiring Futures - Gala Fundraising Display
echo   Serving on http://localhost:8080/
echo.
echo   Keep this window open during the event.
echo   Close it, or press Ctrl+C, to stop the server.
echo.
rem Open the browser a couple of seconds after the server comes up.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8080/"
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8080
) else (
  py -m http.server 8080
)
