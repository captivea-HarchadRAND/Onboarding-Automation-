@echo off
echo ========================================
echo   Onboarding M365 - Demarrage
echo ========================================
echo.

cd /d %~dp0

echo [1/2] Demarrage du backend (port 8081)...
start "Backend - Onboarding" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 3 /noq > nul

echo [2/2] Demarrage du frontend (port 5174)...
start "Frontend - Onboarding" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend  : http://localhost:8081
echo Frontend : http://localhost:5174
echo.
echo Fermez les fenetres pour arreter les serveurs.
