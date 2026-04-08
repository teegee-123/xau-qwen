# XAU Copy Trade - Local Development Testing & Troubleshooting Guide

## Quick Start Commands

### 1. Install Dependencies (First Time Only)

```bash
# Backend
cd backend
npm install

# Frontend (in separate terminal)
cd frontend
npm install
```

### 2. Start Backend Server

```bash
cd backend
npm run dev
```

**Expected Output:**
```
Server running on port 8080
Services: Telegram=false, OANDA=false, Listener=false
```

**Note:** Services showing as `false` is normal if credentials aren't configured - the server should still start.

### 3. Start Frontend Development Server

```bash
cd frontend
npm run dev
```

**Expected Output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### 4. Access Application

Open browser and navigate to: `http://localhost:3000`

---

## Common Issues & Solutions

### ❌ BACKEND ISSUES

#### Problem: Port 8080 already in use
```
Error: listen EADDRINUSE: address already in use :::8080
```

**Solutions:**
1. Find and kill the process using port 8080:
   ```bash
   # Windows Command Prompt
   netstat -ano | findstr :8080
   taskkill /PID <PID> /F

   # PowerShell
   Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess | Stop-Process
   ```

2. Or change the port in backend:
   - Create `.env` file in `backend/` folder
   - Add: `PORT=8081` (or any other available port)
   - Update `frontend/vite.config.ts` proxy target to new port

---

#### Problem: TypeScript compilation errors on startup
```
TSError: ⨯ Unable to compile TypeScript
```

**Solutions:**
1. Check the exact error message - usually missing types or incorrect imports
2. Try reinstalling dependencies:
   ```bash
   cd backend
   rm -rf node_modules package-lock.json
   npm install
   ```

3. Ensure all required files exist:
   ```bash
   # Check if these files exist
   backend/src/index.ts
   backend/src/api/telegram.ts
   backend/src/api/trades.ts
   backend/src/api/config.ts
   backend/src/api/logs.ts
   backend/src/services/logger.service.ts
   backend/src/services/oanda.service.ts
   backend/src/services/telegram.service.ts
   backend/src/workers/telegram-listener.ts
   backend/src/storage/json-store.ts
   ```

---

#### Problem: Missing .env file causing crashes
```
Error: ENOENT: no such file or directory, open '.env'
```

**Solution:**
1. Copy the example file:
   ```bash
   cd backend
   copy ..\.env.example .env
   ```

2. The app should still start with empty credentials (services will fail gracefully)

---

#### Problem: Cannot find module 'xxx'
```
Error: Cannot find module 'cors'
```

**Solution:**
```bash
cd backend
npm install
```

---

### ❌ FRONTEND ISSUES

#### Problem: Port 3000 already in use
```
Error: Port 3000 is already in use
```

**Solutions:**
1. Kill process on port 3000:
   ```bash
   # Windows Command Prompt
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F

   # PowerShell
   Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process
   ```

2. Or change frontend port in `frontend/vite.config.ts`:
   ```typescript
   server: {
     port: 3001,  // Change to different port
     ...
   }
   ```

---

#### Problem: Cannot connect to backend (CORS or proxy errors)
```
Access to XMLHttpRequest at 'http://localhost:8080/api/xxx' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Solutions:**
1. **Verify backend is running** on port 8080
2. **Check proxy configuration** in `frontend/vite.config.ts`:
   ```typescript
   server: {
     port: 3000,
     proxy: {
       '/api': {
         target: 'http://localhost:8080',  // Must match backend port
         changeOrigin: true
       },
       '/socket.io': {
         target: 'http://localhost:8080',
         ws: true,
         changeOrigin: true
       }
     }
   }
   ```

3. **Verify backend CORS is enabled** - Check `backend/src/index.ts` has:
   ```typescript
   app.use(cors());
   ```

---

#### Problem: Blank page or white screen on localhost:3000

**Solutions:**
1. Open browser DevTools (F12) and check Console for errors
2. Common fixes:
   ```bash
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   ```

3. Check if `frontend/src/main.tsx` exists and has correct content:
   ```typescript
   import React from 'react'
   import ReactDOM from 'react-dom/client'
   import App from './App'
   import './index.css'

   ReactDOM.createRoot(document.getElementById('root')!).render(
     <React.StrictMode>
       <App />
     </React.StrictMode>,
   )
   ```

---

#### Problem: Cannot find module 'xxx' in frontend
```
Error: Failed to resolve import "socket.io-client"
```

**Solution:**
```bash
cd frontend
npm install
```

---

### ❌ SOCKET.IO CONNECTION ISSUES

#### Problem: WebSocket connection failed
```
WebSocket connection to 'ws://localhost:3000/socket.io/?EIO=4&transport=websocket' failed
```

**Solutions:**
1. Ensure backend is running
2. Check proxy config for WebSocket in `frontend/vite.config.ts`
3. Backend should log: `Client connected: <socket-id>` when frontend loads

---

### ❌ BOTH SERVERS RUNNING BUT CAN'T ACCESS

#### Problem: localhost:3000 shows "This site can't be reached"

**Checklist:**
- [ ] Frontend dev server actually started (look for "Local: http://localhost:3000" message)
- [ ] No firewall blocking the port
- [ ] Try `http://127.0.0.1:3000` instead
- [ ] Check if browser has cached error page (try incognito mode)

---

## Diagnostic Commands

### Check if servers are running
```bash
# Windows
netstat -ano | findstr "3000 8080"
```

### Test backend API directly
```bash
# In browser or with curl
curl http://localhost:8080/api/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2026-04-07T...",
  "telegram": {...},
  "oanda": {...},
  "listener": {...}
}
```

### Check frontend build
```bash
cd frontend
npm run build
```

If build fails, there are TypeScript errors that need fixing.

---

## Step-by-Step Testing Workflow

### Test 1: Backend Only
1. Start backend: `cd backend && npm run dev`
2. Open browser: `http://localhost:8080/api/health`
3. ✅ Should see JSON response with status "ok"

### Test 2: Frontend Only (Backend Must Be Running)
1. Ensure backend is running
2. Start frontend: `cd frontend && npm run dev`
3. Open browser: `http://localhost:3000`
4. ✅ Should see the dashboard UI
5. Open DevTools (F12) → Console
6. ✅ Should see no red errors

### Test 3: Real-time Connection
1. With both servers running
2. Open DevTools Network tab
3. Look for WebSocket connection
4. ✅ Should see successful socket.io connection
5. Backend console should show: `Client connected: <id>`

### Test 4: API Proxy
1. In browser DevTools Network tab
2. Filter by "Fetch/XHR"
3. The frontend should be making requests to `/api/xxx`
4. ✅ These should successfully proxy to backend
5. ✅ Should see 200 OK responses

---

## Quick Fix Checklist

If NOTHING works:

```bash
# 1. Kill all node processes
taskkill /F /IM node.exe

# 2. Clean reinstall backend
cd backend
rm -rf node_modules dist
npm install

# 3. Clean reinstall frontend
cd ../frontend
rm -rf node_modules dist
npm install

# 4. Create .env file
cd ../backend
copy ..\.env.example .env

# 5. Start backend
cd ../backend
npm run dev

# 6. In NEW terminal, start frontend
cd frontend
npm run dev

# 7. Access http://localhost:3000
```

---

## Expected Console Output

### Backend Terminal (successful start):
```
Telegram service init failed: [expected if no credentials]
OANDA service init failed: [expected if no credentials]
Server running on port 8080
Services: Telegram=false, OANDA=false, Listener=false
```

### Frontend Terminal (successful start):
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### Backend Terminal (when frontend connects):
```
Client connected: <socket-id>
```

---

## File Structure Verification

Make sure these critical files exist:

**Backend:**
```
backend/
├── src/
│   ├── index.ts                    ← Entry point
│   ├── api/
│   │   ├── telegram.ts
│   │   ├── trades.ts
│   │   ├── config.ts
│   │   └── logs.ts
│   ├── services/
│   │   ├── logger.service.ts
│   │   ├── oanda.service.ts
│   │   └── telegram.service.ts
│   ├── workers/
│   │   └── telegram-listener.ts
│   └── storage/
│       └── json-store.ts
├── package.json
└── tsconfig.json
```

**Frontend:**
```
frontend/
├── src/
│   ├── main.tsx                    ← Entry point
│   ├── App.tsx
│   ├── index.css
│   ├── components/
│   └── hooks/
├── index.html
├── vite.config.ts                  ← Proxy config here
├── package.json
└── tailwind.config.js
```

---

## Reporting Errors

When asking for help, provide:

1. **Exact error message** (copy-paste, don't paraphrase)
2. **Which server** (backend/frontend/both)
3. **Terminal output** from both servers
4. **Browser console errors** (F12 → Console tab)
5. **What you tried** already

Example:
```
Backend Error:
- Error: "Cannot find module './services/logger.service'"
- Running: npm run dev in backend/
- Tried: npm install, checked file exists
- File structure: [screenshot or list]
```

---

## Next Steps After Successful Start

1. Configure Telegram credentials via dashboard at `http://localhost:3000/config`
2. Configure OANDA connection
3. Start the listener from the dashboard
4. Test with a simulated signal

---

## Development Tips

- **Hot Reload**: Both servers support hot reload - save a file and it restarts
- **Environment Variables**: Backend uses `.env` file, create it from `.env.example`
- **Logs**: Check both terminal windows for error messages
- **Database**: Uses JSON files, found in `backend/storage/` after first run
- **API Testing**: Use browser, Postman, or curl to test endpoints directly

---

## Support Checklist

Before running `npm run dev`, ensure:
- [ ] Node.js 18+ installed: `node --version`
- [ ] Dependencies installed in both folders: `npm install`
- [ ] No other services using ports 3000 and 8080
- [ ] `.env` file exists in backend/ (can copy from .env.example)
- [ ] All source files present (no missing imports)
- [ ] TypeScript compiles: `npm run build` (optional check)
