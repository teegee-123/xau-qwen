# Deploy to Render Free Tier - Step by Step

## Prerequisites
- GitHub account with this repo pushed
- OANDA practice account credentials
- Telegram API credentials from https://my.telegram.org

---

## Step 1: Prepare Your Repository

```bash
# Ensure yall changes are committed and pushed
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

---

## Step 2: Create Web Service on Render

1. Go to https://render.com and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Render will auto-detect `render.yaml`

**Configure the service:**
| Setting | Value |
|---------|-------|
| **Name** | `xau-copy-trade` |
| **Environment** | `Node` |
| **Region** | `Oregon` (closest to OANDA servers) |
| **Branch** | `main` |
| **Root Directory** | Leave blank |
| **Build Command** | `cd backend && npm install && npm run build && cd ../frontend && npm install && npm run build` |
| **Start Command** | `cd backend && npm start` |
| **Plan** | **Free** |

---

## Step 3: Add Environment Variables

In the Render dashboard, go to **Environment** tab and add:

| Key | Value | Sensitive? |
|-----|-------|------------|
| `NODE_ENV` | `production` | No |
| `PORT` | `8080` | No |
| `NODE_OPTIONS` | `--max-old-space-size=256` | No |
| `TELEGRAM_API_ID` | Your API ID from my.telegram.org | Yes |
| `TELEGRAM_API_HASH` | Your API hash from my.telegram.org | Yes |
| `TELEGRAM_PHONE` | `+1234567890` (your phone) | Yes |
| `OANDA_ACCOUNT_ID` | `101-011-XXXXXXX-XXX` | Yes |
| `OANDA_TOKEN` | Your OANDA API token | Yes |
| `OANDA_ENVIRONMENT` | `practice` (or `live`) | No |
| `TRADING_LOT_SIZE` | `0.01` | No |
| `TRADING_SYMBOL` | `XAU_USD` | No |
| `TRADING_CLOSE_TIMEOUT_MINUTES` | `5` | No |
| `TELEGRAM_CHANNELS` | `-1001222394814,-1003731832656` | No |

> ⚠️ **Important**: Channel IDs must be comma-separated with NO spaces.

---

## Step 4: Deploy

1. Click **"Create Web Service"**
2. Render will build and deploy (~3-5 minutes)
3. Monitor the **Logs** tab for build progress
4. Wait for **"Your service is live 🎉"** message

**Your app URL will be:** `https://xau-copy-trade.onrender.com`

---

## Step 5: Keep-Alive Setup (Critical for Free Tier)

Render free tier **spins down after 15 minutes** of inactivity. To keep it alive:

### Option A: Use Render Cron (Recommended)

Add this to `render.yaml` (already included):
```yaml
cron:
  - name: keep-alive
    schedule: "*/5 * * * *"
    command: curl -f https://xau-copy-trade.onrender.com/api/health || exit 0
```

### Option B: External Ping Service

Use one of these free services to ping `/api/health` every 5 minutes:
- [cron-job.org](https://cron-job.org)
- [UptimeRobot](https://uptimerobot.com)
- GitHub Actions (scheduled workflow)

---

## Step 6: Post-Deployment Setup

### 6.1 Access Dashboard
Open `https://xau-copy-trade.onrender.com` in your browser

### 6.2 Authenticate Telegram
1. Go to **Config** tab
2. Verify Telegram status shows **"Code Sent"** or **"Authenticated"**
3. If not authenticated:
   - Enter your phone number
   - Click **"Request Code"**
   - Check your Telegram app for the code
   - Enter the code in the dashboard

### 6.3 Test OANDA Connection
1. Go to **Config** tab → **OANDA Settings**
2. Click **"Test Connection"**
3. Verify it shows your account balance

### 6.4 Start Listener
1. Go to **Config** tab
2. Scroll to **Telegram Listener**
3. Click **"Start Listener"**
4. Verify status shows **"Active"**

---

## Step 7: Test the System

1. Send `Gold buy 4800` to one of your Telegram channels
2. Check the dashboard **Live Logs** for:
   ```
   [MESSAGE_RECEIVED] Gold buy 4800
   [TRADE_OPENED] Trade opened: XAU_USD BUY @ 4800.00
   ```
3. Verify **Open Trades** table shows the new trade
4. Edit the Telegram message with SL/TP:
   ```
   GOLD BUY NOW

   Buy @ 4685 - 4681

   SL 4780
   TP 4820
   TP 4888

   Care Money Management
   ```
5. Verify trade updates with SL/TP in the dashboard

---

## Troubleshooting

### Build Fails
- Check **Logs** tab for error messages
- Common issues:
  - Missing `render.yaml` or incorrect `rootDir`
  - Node version mismatch (ensure `.nvmrc` has `18`)
  - Insufficient memory (ensure `NODE_OPTIONS` is set)

### App Spins Down
- Verify cron job is running every 5 minutes
- Check cron logs in Render dashboard
- Manual wake: visit `https://xau-copy-trade.onrender.com/api/health`

### Telegram Auth Fails
- Ensure `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are correct
- Phone number must include country code: `+1234567890`
- Check logs for `AUTH_KEY_UNREGISTERED` - re-authenticate if needed

### OANDA Connection Fails
- Verify account ID format: `101-011-XXXXXXX-XXX`
- Token must be from OANDA API management page
- For practice accounts, use `OANDA_ENVIRONMENT=practice`

### Trades Don't Open
- Check **Live Logs** for parsing errors
- Verify channel IDs are in `TELEGRAM_CHANNELS` env var
- Ensure listener is **Active** in Config tab
- Check OANDA status - practice servers sometimes have maintenance

---

## Free Tier Limitations

| Limit | Value | Impact |
|-------|-------|--------|
| **RAM** | 512MB | Telegram client uses ~200-300MB |
| **Monthly Hours** | 750 | Always-on uses ~720, 30hr buffer |
| **Spin Down** | 15 min inactivity | Cron keep-alive prevents this |
| **Storage** | Ephemeral | JSON files reset on redeploy |
| **Build Minutes** | 750/min per month | Each build uses ~5 min |

> ⚠️ **Data Persistence**: Render free tier has ephemeral storage. Trades, logs, and config reset on redeploy. The system recovers open trades from OANDA on restart.

---

## Monitoring

1. **Render Dashboard**: https://dashboard.render.com
2. **App URL**: `https://xau-copy-trade.onrender.com`
3. **Health Check**: `https://xau-copy-trade.onrender.com/api/health`
4. **Logs**: Available in Render dashboard **Logs** tab

---

## Updating the App

```bash
# Make changes locally
git add .
git commit -m "Update description"
git push origin main
```

Render will **auto-deploy** within 1-2 minutes of the push.

---

## Cost Summary

| Resource | Cost |
|----------|------|
| Web Service (Free) | $0 |
| Cron Keep-Alive | $0 |
| **Total** | **$0/month** |
