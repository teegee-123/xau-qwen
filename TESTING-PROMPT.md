# Testing Prompt - XAU Copy Trade System

## 📋 COPY THIS ENTIRE PROMPT FOR TESTING

---

## Quick Test Commands

### Step 1: Start the System

**Option A - Using Batch Script (Easiest):**
```bash
# Double-click this file or run from command line:
start-dev.bat
```

**Option B - Manual Start:**
```bash
# Terminal 1
cd backend
npm run dev

# Terminal 2 (wait 5 seconds)
cd frontend
npm run dev
```

### Step 2: Access the Application

Open your browser and go to: **http://localhost:3000**

### Step 3: Verify Everything Works

**Backend Health Check:**
Open: http://localhost:8080/api/health

Should return:
```json
{
  "status": "ok",
  "timestamp": "...",
  "telegram": false,
  "mt5": false,
  "listener": false
}
```

**Frontend Dashboard:**
- Should load without white screen
- Open DevTools (F12) → Console
- Should have NO red errors
- Should see dashboard UI with tabs

---

## 🔍 Expected Behavior Checklist

### Backend Terminal Should Show:
```
Creating default config.json
Telegram service init failed: Telegram API credentials not configured
OANDA service init failed: MetaApi credentials not configured
Server running on port 8080
Services: Telegram=false, OANDA=false, Listener=false
```

**✅ This is NORMAL - services fail because credentials not set yet**

### Frontend Terminal Should Show:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### Browser Console Should Show:
- No red errors
- May show warnings (OK)
- Dashboard UI loads

### When Frontend Connects to Backend:
Backend terminal should show:
```
Client connected: <some-socket-id>
```

---

## 🐛 Common Issues & Quick Fixes

### Issue: Backend Won't Start

**Check TypeScript compilation:**
```bash
cd backend
npx tsc --noEmit
```

Should show: `(empty)` or `Found 0 errors`

**If errors appear:**
- Re-check import paths are `../` not `../../`
- Make sure all `.ts` files exist
- Run `npm install` in backend folder

---

### Issue: Port Already in Use

**Error:** `EADDRINUSE: address already in use :::8080`

**Fix:**
```bash
# Find process
netstat -ano | findstr :8080

# Kill it (replace PID with actual number)
taskkill /F /PID <PID>
```

---

### Issue: Frontend Shows White Screen

**Fix:**
1. Open DevTools Console (F12)
2. Look for red errors
3. Common fixes:
   ```bash
   cd frontend
   rm -rf node_modules
   npm install
   npm run dev
   ```

---

### Issue: Cannot Connect to Backend

**Check proxy configuration in `frontend/vite.config.ts`:**
```typescript
server: {
  port: 3000,
  proxy: {
    '/api': {
      target: 'http://localhost:8080',  // Must match backend
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

---

## 🧪 Full Testing Workflow

### Test 1: Backend API Endpoints

**Health Check:**
```bash
curl http://localhost:8080/api/health
```

**Get Config:**
```bash
curl http://localhost:8080/api/config
```

Should return default configuration object.

**Get Trades:**
```bash
curl http://localhost:8080/api/trades
```

Should return empty array: `[]`

**Get Logs:**
```bash
curl http://localhost:8080/api/logs
```

Should return logs object with empty array.

---

### Test 2: Frontend UI Components

1. **Open http://localhost:3000**
2. **Check these UI elements exist:**
   - [ ] Tabs/Navigation (Trades, Config, Logs, etc.)
   - [ ] Status indicators (Telegram, MT5, Listener)
   - [ ] Trade history table (should be empty)
   - [ ] Logs panel (should be empty or have system logs)

3. **Test Config Tab:**
   - [ ] Can view configuration
   - [ ] Can update values
   - [ ] Changes save successfully

4. **Test Trades Tab:**
   - [ ] Shows empty state
   - [ ] No console errors when clicking

---

### Test 3: Real-time Updates (Socket.io)

1. Open DevTools Network tab
2. Look for WebSocket connection
3. Should show connection to `/socket.io/`
4. Backend terminal should log: `Client connected: ...`

---

### Test 4: Data Persistence

1. Update config via dashboard
2. Refresh browser page
3. Config should still show updated values
4. Check `backend/src/storage/data/config.json` file
5. Should contain your changes

---

## 🎯 Integration Test (With Credentials)

If you have Telegram/MT5 credentials:

### 1. Configure Telegram
```bash
curl -X POST http://localhost:8080/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "telegram": {
      "phoneNumber": "+YOUR_PHONE",
      "apiId": "YOUR_API_ID",
      "apiHash": "YOUR_API_HASH",
      "channels": [],
      "isAuthenticated": false
    }
  }'
```

### 2. Request Auth Code
```bash
curl -X POST http://localhost:8080/api/telegram/request \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+YOUR_PHONE"
  }'
```

### 3. Complete Auth
```bash
curl -X POST "http://localhost:8080/api/telegram/auth?code=12345"
```

### 4. Start Listener
Update config with `listener.isActive: true` via dashboard or API.

---

## 📊 Performance Test

### Load Test API:
```bash
# Make 100 requests
for /L %i in (1,1,100) do curl http://localhost:8080/api/health >nul

# Check backend still works
curl http://localhost:8080/api/health
```

Should still respond correctly.

---

## ✅ Success Criteria

The system is working correctly if:

1. ✅ Backend starts without TypeScript errors
2. ✅ Backend responds on port 8080
3. ✅ Frontend starts without build errors
4. ✅ Dashboard loads at http://localhost:3000
5. ✅ No red errors in browser console
6. ✅ WebSocket connection established
7. ✅ Can view/update config
8. ✅ API endpoints return proper JSON
9. ✅ Data persists between refreshes
10. ✅ Services show as disconnected (expected without credentials)

---

## 📝 Test Report Template

Copy this and fill in your results:

```
TEST DATE: ___________

BACKEND:
- Starts without errors: YES / NO
- Port 8080 accessible: YES / NO
- Health endpoint works: YES / NO
- Console output: (paste output)

FRONTEND:
- Starts without errors: YES / NO
- Port 3000 accessible: YES / NO
- Dashboard loads: YES / NO
- No console errors: YES / NO
- Console output: (paste output)

SOCKET.IO:
- WebSocket connects: YES / NO
- Backend shows client connected: YES / NO

API ENDPOINTS:
- GET /api/health: 200 OK / FAILED
- GET /api/config: 200 OK / FAILED
- GET /api/trades: 200 OK / FAILED
- GET /api/logs: 200 OK / FAILED

DATA PERSISTENCE:
- Config saves: YES / NO
- Config persists after refresh: YES / NO

OVERALL STATUS: WORKING / PARTIAL / BROKEN
ISSUES FOUND: (list any)
```

---

## 🚀 Quick Smoke Test (30 seconds)

```bash
# 1. Start backend
cd backend && npm run dev &

# 2. Wait
timeout /t 5

# 3. Test backend
curl http://localhost:8080/api/health

# 4. Start frontend
cd ..\frontend && npm run dev &

# 5. Wait
timeout /t 5

# 6. Open browser
start http://localhost:3000

# 7. Check visually - does dashboard load?
```

---

## 🔧 Troubleshooting Decision Tree

```
Can't access localhost:3000?
├─ Frontend server not running?
│  └─ Run: cd frontend && npm run dev
├─ Port conflict?
│  └─ Check: netstat -ano | findstr :3000
└─ Build error?
   └─ Check frontend terminal for errors

Backend won't start?
├─ TypeScript errors?
│  └─ Run: npx tsc --noEmit
├─ Port conflict?
│  └─ Check: netstat -ano | findstr :8080
└─ Missing dependencies?
   └─ Run: npm install

Frontend can't reach backend?
├─ Backend not running?
│  └─ Start backend first
├─ Wrong port in proxy config?
│  └─ Check frontend/vite.config.ts
└─ CORS error?
   └─ Backend has cors() middleware enabled

Dashboard shows white screen?
├─ Check browser console (F12)
├─ React build error?
│  └─ Check frontend terminal
└─ Can't connect to backend?
   └─ Backend should return at least empty data
```

---

## 📞 When Asking for Help

Provide this information:

1. **What happens when you run:**
   ```bash
   cd backend && npm run dev
   ```
   (Paste full output)

2. **What happens when you run:**
   ```bash
   cd frontend && npm run dev
   ```
   (Paste full output)

3. **Browser console errors:**
   - Open http://localhost:3000
   - Press F12
   - Copy any red errors from Console tab

4. **Backend health check:**
   ```bash
   curl http://localhost:8080/api/health
   ```
   (Paste response)

5. **What you've already tried:**
   - List all troubleshooting steps attempted

---

## 🎓 Understanding the Architecture

```
User Browser (localhost:3000)
    ↓
Frontend React App (Vite dev server)
    ↓ (proxied API calls)
Backend Express API (localhost:8080)
    ↓
Services (Telegram, MT5 - stub mode)
    ↓
JSON File Storage (data persistence)
```

**Request Flow:**
1. User opens http://localhost:3000
2. Vite serves React app
3. React app makes API calls to `/api/*`
4. Vite proxies to `http://localhost:8080/api/*`
5. Backend Express handles request
6. Backend reads/writes JSON files
7. Response returns through proxy to browser

**WebSocket Flow:**
1. Frontend Socket.io client connects
2. Connects to backend via proxy
3. Backend emits events on `io`
4. Frontend receives real-time updates

---

## 💡 Pro Tips

- **Hot Reload:** Both servers auto-restart when you save files
- **Data Files:** Located in `backend/src/storage/data/`
- **Logs:** Check both terminal windows for debugging
- **Environment:** Backend uses `.env` file for config
- **Default Config:** Auto-created on first backend run

---

## 🎉 If Everything Works

Congratulations! Your system is ready to:

1. Configure Telegram credentials
2. Configure MT5 connection
3. Set up channel monitoring
4. Test with real signals
5. Monitor trades in real-time

**Next:** See README.md for configuration guide.
