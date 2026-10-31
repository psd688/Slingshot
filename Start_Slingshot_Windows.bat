@echo off
title Pixazon Slingshot Interactive Wall Server
cd /d "%~dp0"

echo =================================================================
echo        PIXAZON SLINGSHOT INTERACTIVE WALL (WINDOWS LAUNCHER)     
echo =================================================================
echo.

set NODE_CMD=node
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "bin\node.exe" (
        set NODE_CMD="bin\node.exe"
        echo [✓] Using bundled portable Node.js runtime...
    ) else (
        echo [!] Node.js not found. Please install Node.js from https://nodejs.org/
        pause
        exit /b 1
    )
) else (
    echo [✓] Found System Node.js...
)

echo [*] Starting Slingshot Server...
start "" %NODE_CMD% server.js

timeout /t 2 /nobreak >nul

echo [*] Opening TV Wall in Browser...
start "" "http://localhost:3000/tv.html"

echo.
echo =================================================================
echo   TV Display Wall:    http://localhost:3000/tv.html
echo   Phone Controller:   Scan QR code on TV screen
echo =================================================================
echo.
pause

