@echo off
echo ========================================
echo   Onboarding M365 - Redemarrage
echo ========================================
echo.

cd /d %~dp0

echo Arret des serveurs en cours sur les ports 8081 et 5175...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8081" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5175" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak > nul

echo [1/2] Demarrage du backend (port 8081)...
start "Backend - Onboarding" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 3 /nobreak > nul

echo [2/2] Demarrage du frontend (port 5175)...
start "Frontend - Onboarding" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend  : http://localhost:8081
echo Frontend : http://localhost:5175
echo.
echo Serveurs redemarres. Fermez les fenetres pour les arreter.
timeout /t 3 /nobreak > nul
