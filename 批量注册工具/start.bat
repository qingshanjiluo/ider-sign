@echo off
chcp 65001 >nul
title Aidler Batch Tool

cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 16+
    echo [ERROR] Download: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [..] Installing dependencies...
    call npm install --registry=https://registry.npmmirror.com
    if %ERRORLEVEL% neq 0 (
        echo [FAIL] npm install failed.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
)

node batch.js

echo.
pause