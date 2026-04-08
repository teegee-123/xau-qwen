# XAU Copy Trade Dashboard

A professional trading dashboard that listens to Telegram channels for Gold buy signals and automatically places trades via MT5.

## Features

- **Telegram Integration**: MTProto-based connection to monitor channels for trading signals
- **OANDA Integration**: Native REST API for cloud-based trading (no terminal required)
- **Automatic Trading**: Places buy orders immediately when signal detected
- **Smart SL/TP**: Updates stop loss and take profit when message is edited (uses lowest TP)
- **Auto-Close**: Closes trades if no edit received within configurable timeout (default 3 min)
- **Retry Logic**: Automatic retry with logging for failed OANDA operations
- **Real-time Dashboard**: Black/green themed responsive UI with live logs and trade tracking
- **JSON Storage**: Lightweight file-based storage (trades, logs, config)

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + TailwindCSS
- **Real-time**: Socket.io for WebSocket communication
- **Telegram**: GramJS (MTProto)
- **OANDA**: Native REST API (cloud-based, no terminal required)
- **Storage**: JSON files (trades.json, logs.json, config.json)

## Project Structure

```
xau-copy-trade-2/
├── backend/
│   ├── src/
│   │   ├── api/              # Express routes
│   │   ├── services/         # Business logic
│   │   ├── workers/          # Background tasks
│   │   ├── storage/          # JSON file storage
│   │   └── index.ts          # Entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom hooks
│   │   └── App.tsx           # Main app
│   └── package.json
├── tests/                    # Test suite
└── render.yaml               # Deployment config
```

## Setup

### Prerequisites

- Node.js 18+
- Telegram API credentials (api_id, api_hash) from https://my.telegram.org
- OANDA account (for cloud trading) - **See [OANDA Setup](#oanda-setup)**

## Quick Start

### Start Both Services (Recommended)

```bash
# First time: install all dependencies
npm run install:all

# Start both backend and frontend with one command
npm run start-app

# Or use the shorter alias
npm run dev
```

This launches both services in a single terminal with color-coded output:
- **Backend**: http://localhost:8080
- **Frontend**: http://localhost:3000

Press `Ctrl+C` to stop both services.

### Manual Start (Separate Terminals)

**Backend Setup**

```bash
cd backend
npm install
npm run dev
```

**Frontend Setup** (separate terminal)

```bash
cd frontend
npm install
npm run dev
```

### Build for Production

```bash
# Build frontend
cd frontend
npm run build

# Build backend
cd ../backend
npm run build
npm start
```

## Configuration

Configure via dashboard at `/config` tab:

### Telegram
- **Phone Number**: Your Telegram account phone number
- **API ID**: From my.telegram.org
- **API Hash**: From my.telegram.org
- **Channels**: List of channel IDs to monitor (comma-separated)

### OANDA
- **Account ID**: From OANDA account settings
- **Token**: API token from OANDA dashboard
- **Environment**: `practice` (demo) or `live` (real money)

### Trading
- **Lot Size**: Fixed lot size for trades (default: 0.01)
- **Symbol**: Trading symbol (default: XAUUSD)
- **Close Timeout**: Minutes before auto-close if no edit (default: 3)
- **Max Retries**: Retry attempts for failed operations (default: 3)

## API Endpoints

### Telegram Authentication
```
POST /api/telegram/request
Body: { "phoneNumber": "+1234567890" }

POST /api/telegram/auth?code=12345
```

### Trades
```
GET /api/trades          # All trades
GET /api/trades/open     # Open trades
GET /api/trades/closed   # Closed trades
POST /api/trades/:id/close  # Manually close trade
```

### Config
```
GET /api/config          # Get configuration
PUT /api/config          # Update configuration
```

### Logs
```
GET /api/logs            # Get logs (supports pagination)
```

### Health
```
GET /api/health          # Health check (for cron keep-alive)
```

## Deploy to Render

1. Push code to GitHub repository
2. Connect to Render dashboard
3. Create new Web Service from repo
4. Render will auto-detect `render.yaml`
5. Set environment variables if needed
6. Deploy!

Cron job will automatically ping `/api/health` every 5 minutes to keep the service awake on free tier.

## How It Works

1. **Signal Detection**: Listens to Telegram channels for "Gold buy {price}" messages
2. **Immediate Entry**: Places market buy order immediately when signal detected
3. **Message Monitoring**: Waits for message to be edited with SL/TP details
4. **SL/TP Update**: When edited, updates trade with stop loss and take profit (lowest TP used)
5. **Auto-Close**: If no edit within timeout period, closes trade automatically
6. **Logging**: All actions logged asynchronously with real-time WebSocket updates

## Message Format

### Initial Signal
```
Gold buy 4617
```

### Edited Message (with SL/TP)
```
GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690
TP
4777
```

System extracts: Entry range (4685-4681), SL (4500), TP (4690 - lowest of 4690 and 4777)

## Testing

Run full test suite:

```bash
cd backend
npm test
```

Tests cover:
- Message parsing (initial and edited signals)
- Trade manager lifecycle
- JSON storage operations
- Telegram authentication
- MT5 integration with retry logic
- E2E flows (full lifecycle, timeout, retry, multi-channel)

## License

MIT
