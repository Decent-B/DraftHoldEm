@echo off
cd /d "%~dp0"
if not exist "node_modules\ws\package.json" call npm install
npm start
pause
