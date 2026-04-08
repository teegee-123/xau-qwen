@echo off
echo ========================================
echo XAU Copy Trade - System Diagnostic
echo ========================================
echo.

:: Check Node.js
echo [1/6] Checking Node.js version...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed or not in PATH
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js: %NODE_VERSION%
echo.

:: Check backend dependencies
echo [2/6] Checking backend dependencies...
cd backend
if exist node_modules (
    echo ✅ Backend node_modules exists
) else (
    echo ❌ Backend node_modules missing - running npm install...
    call npm install
)
cd ..
echo.

:: Check frontend dependencies
echo [3/6] Checking frontend dependencies...
cd frontend
if exist node_modules (
    echo ✅ Frontend node_modules exists
) else (
    echo ❌ Frontend node_modules missing - running npm install...
    call npm install
)
cd ..
echo.

:: Check .env file
echo [4/6] Checking .env configuration...
cd backend
if exist .env (
    echo ✅ .env file exists
) else (
    echo ⚠️  .env file missing - creating from example...
    copy ..\.env.example .env >nul
    echo ✅ Created .env from .env.example
)
cd ..
echo.

:: Check critical backend files
echo [5/6] Checking critical backend files...
set FILES_OK=1
if not exist backend\src\index.ts (
    echo ❌ Missing: backend\src\index.ts
    set FILES_OK=0
)
if not exist backend\src\services\logger.service.ts (
    echo ❌ Missing: backend\src\services\logger.service.ts
    set FILES_OK=0
)
if not exist backend\src\services\oanda.service.ts (
    echo ❌ Missing: backend\src\services\oanda.service.ts
    set FILES_OK=0
)
if not exist backend\src\services\telegram.service.ts (
    echo ❌ Missing: backend\src\services\telegram.service.ts
    set FILES_OK=0
)
if %FILES_OK%==1 (
    echo ✅ All critical backend files exist
)
echo.

:: Check critical frontend files
echo [6/6] Checking critical frontend files...
set FILES_OK=1
if not exist frontend\src\main.tsx (
    echo ❌ Missing: frontend\src\main.tsx
    set FILES_OK=0
)
if not exist frontend\src\App.tsx (
    echo ❌ Missing: frontend\src\App.tsx
    set FILES_OK=0
)
if not exist frontend\vite.config.ts (
    echo ❌ Missing: frontend\vite.config.ts
    set FILES_OK=0
)
if %FILES_OK%==1 (
    echo ✅ All critical frontend files exist
)
echo.

echo ========================================
echo ✅ System diagnostic complete!
echo ========================================
echo.
echo Next steps:
echo 1. Start BACKEND: cd backend ^&^& npm run dev
echo 2. Start FRONTEND: cd frontend ^&^& npm run dev
echo 3. Open browser: http://localhost:3000
echo.
echo If you encounter errors, check TESTING-GUIDE.md
echo.
pause
