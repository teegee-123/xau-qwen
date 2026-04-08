@echo off
echo ========================================
echo Starting XAU Copy Trade Development
echo ========================================
echo.

:: Check if backend .env exists
cd backend
if not exist .env (
    echo ⚠️  Creating .env file...
    copy ..\.env.example .env >nul
    echo ✅ .env created
)
cd ..

echo Starting BACKEND server...
echo.
start "XAU Backend" cmd /k "cd backend && echo Backend Server Starting... && npm run dev"

echo Waiting for backend to start...
timeout /t 5 /nobreak >nul

echo.
echo Starting FRONTEND server...
echo.
start "XAU Frontend" cmd /k "cd frontend && echo Frontend Server Starting... && npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo ✅ Servers Starting!
echo ========================================
echo.
echo Backend:  http://localhost:8020
echo Frontend: http://localhost:3020
echo.
echo Opening dashboard in browser...
timeout /t 2 /nobreak >nul
start http://localhost:3020

echo.
echo Check the two terminal windows for status.
echo Press any key to close this window...
pause >nul
