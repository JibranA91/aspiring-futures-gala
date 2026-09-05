@echo off
setlocal enabledelayedexpansion
title Aspiring Futures - Gala Display  (keep this window open)
cd /d "%~dp0gala"

rem Find this laptop's LAN IP (the address another device on the same network uses).
set "LANIP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try{$u=New-Object Net.Sockets.UdpClient;$u.Connect('8.8.8.8',80);$u.Client.LocalEndPoint.Address.ToString()}catch{''}"`) do set "LANIP=%%i"

echo.
echo   Aspiring Futures - Gala Fundraising Display
echo.
echo   This laptop:    http://localhost:8080/
if defined LANIP (
  echo   Other laptop:   http://!LANIP!:8080/audience.html    ^(same Wi-Fi / network^)
) else (
  echo   Other laptop:   not connected to a network
)
echo.
echo   Keep this window open during the event.
echo   Close it, or press Ctrl+C, to stop the server.
echo   ^(If Windows asks, allow Python through the firewall so the other laptop can connect.^)
echo.
rem Open this laptop's browser a couple of seconds after the server comes up.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:8080/"
where python >nul 2>nul
if errorlevel 1 (
  py -m http.server 8080
) else (
  python -m http.server 8080
)
