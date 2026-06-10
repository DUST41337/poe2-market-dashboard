@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

if not exist public\data\market.json (
  call npm run update:data
  if errorlevel 1 exit /b %errorlevel%
)

node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 4174 --strictPort
