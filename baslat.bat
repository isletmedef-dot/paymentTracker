@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Odeme Takip
echo ============================================
echo   ODEME TAKIP baslatiliyor...
echo ============================================
echo.
if not exist node_modules (
  echo Ilk kurulum: gerekli paketler indiriliyor, lutfen bekleyin...
  call npm install
)
echo Tarayici aciliyor: http://127.0.0.1:3400
start "" http://127.0.0.1:3400
node server.js
echo.
echo Sunucu kapandi. Bu pencereyi kapatabilirsiniz.
pause
