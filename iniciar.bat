@echo off
cd /d "%~dp0"
if not exist dist\index.html (
  echo Compilando Once 11...
  call npm run build
)
start "Once 11 servidor" cmd /k "node server\index.mjs"
timeout /t 2 /nobreak >nul
start "Once 11 escuchador" cmd /k "powershell -NoProfile -ExecutionPolicy Bypass -File tools\escuchar.ps1"
timeout /t 1 /nobreak >nul
if exist tools\cloudflared.exe (
  tools\cloudflared.exe tunnel --url http://127.0.0.1:8787
) else (
  echo Falta tools\cloudflared.exe
  pause
)
