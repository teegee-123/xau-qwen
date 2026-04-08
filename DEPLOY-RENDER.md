# Deploy to Render - Complete Step-by-Step Guide

## Architecture Overview

This project deploys as a **single Render web service** that serves both the backend API and frontend dashboard from one URL:

```
https://xau-copy-trade.onrender.com
├── /api/*          → Backend API (Express)
├── /socket.io/*    → WebSocket (Socket.IO)
└── /*              → Frontend (React, served as static files)
```

**How it works:**
1. **Build**: TypeScript compiles to `backend/dist/`, React builds to `backend/public/`
2. **Start**: `node dist/index.js` serves everything on one port
3. **Single process** handles API, WebSocket, and frontend

---

## Step 1: Push Code to GitHub

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

> Ensure all files are committed, including `render.yaml` and `.gitignore`.

---

## Step 2: Create Web Service on Render

1. Go to **[https://dashboard.render.com](https://dashboard.render.com)** and sign in
2. Click **New +** → **Web Service**
3. Click **Connect a repository** → select your GitHub repo
4. Render will auto-detect `render.yaml`

**Configure the service:**

| Setting | Value |
|---------|-------|
| **Name** | `xau-copy-trade` |
| **Region** | `Oregon` (closest to OANDA servers) |
| **Branch** | `main` |
| **Root Directory** | *(leave blank)* |
| **Runtime** | `Node` |
| **Build Command** | `cd backend && npm install && npm run build && cd ../frontend && npm install && npm run build` |
| **Start Command** | `cd backend && npm start` |
| **Plan** | **Free** |

Click **Create Web Service**.

---

## Step 3: Add Environment Variables

In the Render dashboard, go to your service → **Environment** tab → **Add Environment Variable**:

| Key | Value | Sensitive? |
|-----|-------|------------|
| `NODE_ENV` | `production` | No |
| `PORT` | `8080` | No |
| `NODE_OPTIONS` | `--max-old-space-size=256` | No |
| `TELEGRAM_API_ID` | Your numeric API ID from my.telegram.org | ✅ Yes |
| `TELEGRAM_API_HASH` | Your API hash from my.telegram.org | ✅ Yes |
| `TELEGRAM_PHONE` | `+1234567890` (with country code) | ✅ Yes |
| `OANDA_ACCOUNT_ID` | `101-011-XXXXXXX-XXX` | ✅ Yes |
| `OANDA_TOKEN` | Your OANDA API token | ✅ Yes |
| `OANDA_ENVIRONMENT` | `practice` (or `live`) | No |
| `TRADING_LOT_SIZE` | `0.01` | No |
| `TRADING_SYMBOL` | `XAU_USD` | No |
| `TRADING_CLOSE_TIMEOUT_MINUTES` | `5` | No |
| `TELEGRAM_CHANNELS` | `-1001222394814,-1003731832656` | No |

> ⚠️ **Channel IDs**: Comma-separated, **no spaces**. Example: `-1001222394814,-1003731832656`

Click **Save**.

---

## Step 4: Deploy

1. Render will automatically start building after you save environment variables
2. Monitor the **Logs** tab for build progress (~3-5 minutes)
3. Wait for **"Your service is live 🎉"**

**Your app URL:** `https://xau-copy-trade.onrender.com`

---

## Step 5: Post-Deployment Setup

### 5.1 Access Dashboard
Open `https://xau-copy-trade.onrender.com` in your browser.

### 5.2 Authenticate Telegram
1. Go to **Config** tab
2. Under **Telegram**, if status shows "Not Authenticated":
   - Enter your phone number
   - Click **Request Code**
   - Check your Telegram app for the 5-digit code
   - Enter the code and click **Verify**
3. Status should show **"Authenticated"**

### 5.3 Test OANDA Connection
1. In **Config** tab, scroll to **OANDA Settings**
2. Click **Test Connection**
3. Verify it shows your account balance

### 5.4 Start Listener
1. In **Config** tab, scroll to **Telegram Listener**
2. Click **Start Listener**
3. Status should show **"Active"**

---

## Step 6: Keep-Alive Setup (Critical for Free Tier)

Render free tier **spins down after 15 minutes** of inactivity. To keep it alive, ping the health endpoint every 5 minutes.

### Option A: cron-job.org (Recommended)
1. Go to **[https://cron-job.org](https://cron-job.org)**
2. Create a free account
3. Create new cron job:
   - **URL**: `https://xau-copy-trade.onrender.com/api/health`
   - **Schedule**: Every 5 minutes
   - **Method**: GET

### Option B: UptimeRobot
1. Go to **[https://uptimerobot.com](https://uptimerobot.com)**
2. Create a free monitor
3. Set URL to `https://xau-copy-trade.onrender.com/api/health`
4. Set monitoring interval to 5 minutes

### Option C: GitHub Actions
Create `.github/workflows/keep-alive.yml`:
```yaml
name: Render Keep-Alive
on:
  schedule:
    - cron: "*/5 * * * *"
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -f https://xau-copy-trade.onrender.com/api/health || exit 0
```

---

## Step 7: Test the System

### 7.1 Test Signal Detection
1. Send this message to one of your Telegram channels:
   ```
   Gold buy 4800
   ```
2. Check the dashboard **Live Logs** for:
   ```
   [MESSAGE_RECEIVED] Gold buy 4800
   [TRADE_OPENED] Trade opened: XAU_USD BUY @ 4800.00
   ```
3. Verify **Open Trades** table shows the new trade

### 7.2 Test SL/TP Update
1. Edit the Telegram message to:
   ```
   GOLD BUY NOW

   Buy @ 4778 - 4779

   SL 4786
   TP 4790
   TP 4889

   Care Money Management
   ```
2. Verify trade updates with SL/TP in the dashboard

### 7.3 Test Price Streaming
1. Check the **Price Display** at the top of the dashboard
2. Prices should update in real-time with ↑/↓ arrows

---

## Troubleshooting

### Build Fails
- **Check Logs tab** for error messages
- Common issues:
  - `render.yaml` missing or incorrect
  - Node version mismatch (ensure `.nvmrc` exists with `18`)
  - Memory limit exceeded (ensure `NODE_OPTIONS` is set)

### App Shows "Frontend not built"
- Frontend build may have failed
- Check logs for `frontend npm run build` errors
- Verify `vite.config.ts` has `outDir: '../backend/public'`

### App Spins Down / Times Out
- Verify keep-alive cron is running every 5 minutes
- Check cron-job.org execution logs
- Manual wake: visit `https://xau-copy-trade.onrender.com/api/health`

### Telegram Auth Fails
- Ensure `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are correct
- Phone number must include country code: `+1234567890`
- Check logs for `AUTH_KEY_UNREGISTERED` → re-authenticate

### OANDA Connection Fails
- Verify account ID format: `101-011-XXXXXXX-XXX`
- Token must be from OANDA API management page
- For practice accounts, use `OANDA_ENVIRONMENT=practice`

### Trades Don't Open
- Check **Live Logs** for parsing errors
- Verify channel IDs are in `TELEGRAM_CHANNELS` env var
- Ensure listener is **Active** in Config tab
- Check OANDA status - practice servers sometimes have maintenance

### PnL Always Shows $0
- Trade was already closed by OANDA server-side (TP/SL hit)
- System calculates PnL from current market price as fallback
- Check logs: `[TradeManager] Trade already closed on OANDA, calculated PnL: ...`

---

## Free Tier Limitations

| Limit | Value | Impact |
|-------|-------|--------|
| **RAM** | 512MB | Telegram client uses ~200-300MB. `NODE_OPTIONS` caps at 256MB |
| **Monthly Hours** | 750 | Always-on uses ~720 hours, 30hr buffer |
| **Spin Down** | 15 min inactivity | Cron keep-alive prevents this |
| **Storage** | Ephemeral | JSON files reset on redeploy. Trades recover from OANDA on restart |
| **Build Minutes** | 750/min per month | Each build uses ~5 min |

> ⚠️ **Data Persistence**: Render free tier has ephemeral storage. Trades, logs, and config reset on redeploy. The system recovers open trades from OANDA on restart.

---

## Updating the App

```bash
# Make changes locally
git add .
git commit -m "Update description"
git push origin main
```

Render will **auto-deploy** within 1-2 minutes of the push (if `autoDeploy: true` in `render.yaml`).

---

## Monitoring

| What | Where |
|------|-------|
| **Dashboard** | `https://xau-copy-trade.onrender.com` |
| **API Health** | `https://xau-copy-trade.onrender.com/api/health` |
| **Build/Deploy Logs** | Render dashboard → **Logs** tab |
| **Runtime Logs** | Render dashboard → **Logs** tab (real-time) |

---

## Cost Summary

| Resource | Cost |
|----------|------|
| Web Service (Free) | $0 |
| Keep-Alive Cron (cron-job.org) | $0 |
| **Total** | **$0/month** |
