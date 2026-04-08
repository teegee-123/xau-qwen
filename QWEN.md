# XAU Copy Trade - Project Context

## Project Overview

**XAU Copy Trade** is an automated trading system that monitors Telegram channels for Gold (XAU) buy signals and automatically executes trades via OANDA REST API. The system features a real-time web dashboard for monitoring trades, logs, and configuration.

### Core Workflow

1. **Signal Detection**: Listens to Telegram channels (via MTProto) for messages matching `Gold buy {price}`
2. **Immediate Execution**: Places market buy order on MT5 instantly when signal detected
3. **SL/TP Update**: When Telegram message is edited with Stop Loss/Take Profit levels, updates the position (uses lowest TP)
4. **Auto-Close**: Closes trade if no edit received within configurable timeout (default: 3 min)
5. **Real-time Dashboard**: React web UI with live logs, trades, and status via WebSocket

**Important**: System only processes BUY signals for XAU/GOLD - SELL signals are ignored.

---

## Tech Stack

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.18
- **Language**: TypeScript 5.3 (strict mode, ES2020, CommonJS)
- **Real-time**: Socket.IO 4.7
- **Telegram**: GramJS (telegram v2.26) - MTProto client
- **OANDA**: Native REST API (oanda.service.ts)
- **Storage**: JSON files with async file locking
- **Dev**: ts-node-dev (hot reload), Jest + ts-jest (testing)

### Frontend
- **Framework**: React 18.2
- **Build Tool**: Vite 5
- **Language**: TypeScript 5.3 (ES modules)
- **Styling**: TailwindCSS 3.3 (custom trading theme)
- **Charts**: Recharts 2.10
- **Icons**: Lucide React 0.294
- **Real-time**: socket.io-client 4.7

### Deployment
- **Platform**: Render (free tier)
- **Keep-alive**: Cron pings `/api/health` every 5 minutes

---

## Project Structure

```
xau-copy-trade-2/
├── backend/
│   ├── src/
│   │   ├── index.ts                      # Express + Socket.IO server, bootstrap
│   │   ├── api/                          # Express route handlers
│   │   │   ├── telegram.ts               # Telegram auth endpoints
│   │   │   ├── trades.ts                 # Trade CRUD endpoints
│   │   │   ├── config.ts                 # Config get/update
│   │   │   └── logs.ts                   # Log retrieval with pagination
│   │   ├── services/                     # Core business logic
│   │   │   ├── telegram.service.ts       # MTProto connection & auth
│   │   │   ├── oanda.service.ts          # OANDA REST API trading
│   │   │   ├── message-parser.ts         # Regex parsing of signals
│   │   │   ├── trade-manager.ts          # Signal→trade lifecycle orchestration
│   │   │   └── logger.service.ts         # Async logging with Socket.IO broadcast
│   │   ├── workers/
│   │   │   └── telegram-listener.ts      # Background worker polling channels
│   │   └── storage/
│   │       ├── json-store.ts             # Typed JSON I/O with file locking
│   │       └── data/                     # Auto-created on first run
│   │           ├── config.json           # Application configuration
│   │           ├── trades.json           # All trade records
│   │           └── logs.json             # All log entries
│   ├── public/                           # Built frontend (from Vite build)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env                              # Environment variables (auto-created from .env.example)
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx                      # React entry point
│   │   ├── App.tsx                       # Root component: tabs, polling, error handling
│   │   ├── index.css                     # Tailwind + custom theme
│   │   ├── components/
│   │   │   ├── StatusChips.tsx           # Service status indicators
│   │   │   ├── LiveLogs.tsx              # Real-time log feed (Socket.IO)
│   │   │   ├── OpenTrades.tsx            # Open positions table
│   │   │   ├── TradeHistory.tsx          # Closed trades table
│   │   │   └── ConfigPanel.tsx           # Configuration form
│   │   └── hooks/
│   │       └── useSocket.ts              # Socket.IO hook
│   ├── vite.config.ts                    # Vite config: proxy + build output
│   ├── package.json
│   └── tsconfig.json
│
├── tests/                                # Jest test suite
│   ├── e2e.test.ts                       # End-to-end lifecycle
│   ├── message-parser.test.ts            # Signal parsing
│   ├── trade-manager.test.ts             # Trade manager lifecycle
│   ├── json-storage.test.ts              # JSON storage operations
│   ├── mt5-integration.test.ts           # MT5 integration with retry
│   └── telegram-auth.test.ts             # Telegram MTProto auth
│
├── .env.example                          # Environment variable template
├── jest.config.js                        # Jest configuration
├── tsconfig.test.json                    # Test TypeScript config
├── render.yaml                           # Render deployment manifest
├── TESTING-GUIDE.md                      # Troubleshooting guide
├── TESTING-PROMPT.md                     # Testing scenarios
├── FIXES-APPLIED.md                      # Applied fixes documentation
├── start-dev.bat                         # Windows dev startup
└── diagnostic.bat                        # System diagnostic script
```

---

## Building and Running

### Development Mode

**Start Backend:**
```bash
cd backend
npm install          # First time only
npm run dev          # Hot-reload server on port 8080
```

**Start Frontend (separate terminal):**
```bash
cd frontend
npm install          # First time only
npm run dev          # Vite dev server on port 3000
```

**Quick Start (Windows):**
```bash
start-dev.bat        # Starts both servers automatically
```

**Access Application:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- Health Check: http://localhost:8080/api/health

### Production Build

```bash
# Build frontend (outputs to backend/public/)
cd frontend
npm run build

# Build and start backend
cd ../backend
npm run build        # TypeScript → dist/
npm start            # node dist/index.js
```

### Testing

```bash
cd backend
npm test              # Run tests with coverage
npm run test:watch    # Watch mode
```

Coverage thresholds: 70% branches, 80% functions/lines/statements

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/telegram/request` | Request Telegram auth code |
| POST | `/api/telegram/auth?code=XXXXX` | Submit auth code |
| GET | `/api/trades` | All trades |
| GET | `/api/trades/open` | Open trades only |
| GET | `/api/trades/closed` | Closed trades only |
| POST | `/api/trades/:id/close` | Manually close trade |
| GET | `/api/config` | Get configuration |
| PUT | `/api/config` | Update configuration |
| GET | `/api/logs` | Get logs (paginated, query: `?page=&limit=`) |
| GET | `/api/health` | Health check & service status |

---

## Configuration

### Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Backend server port |
| `NODE_ENV` | development | Environment mode |
| `TELEGRAM_API_ID` | - | From my.telegram.org |
| `TELEGRAM_API_HASH` | - | From my.telegram.org |
| `TELEGRAM_PHONE` | - | Phone number for MTProto |
| `OANDA_ACCOUNT_ID` | - | OANDA account number |
| `OANDA_TOKEN` | - | OANDA API token |
| `OANDA_ENVIRONMENT` | practice | `practice` or `live` |
| `TRADING_LOT_SIZE` | 0.01 | Default lot size |
| `TRADING_SYMBOL` | XAUUSD | Trading symbol |
| `TRADING_CLOSE_TIMEOUT_MINUTES` | 3 | Auto-close timeout |
| `TRADING_MAX_RETRIES` | 3 | Max retry attempts |
| `TRADING_RETRY_DELAY_MS` | 2000 | Delay between retries |
| `TELEGRAM_CHANNELS` | - | Comma-separated channel IDs |

### Runtime Config

Managed via dashboard `/config` tab, stored in `backend/src/storage/data/config.json`. Auto-created with defaults on first run.

---

## Signal Message Format

**Initial Signal** (triggers immediate buy):
```
Gold buy 4617
```

**Edited Message** (provides SL/TP):
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

Parser extracts: Entry range (4685-4681), SL (4500), TP (4690 - lowest of all TPs)

---

## Development Conventions

### Code Style
- **Backend**: TypeScript with strict mode, CommonJS modules, ES2020 target
- **Frontend**: TypeScript with ES modules, React functional components
- **Imports**: Use relative paths (e.g., `../services/logger.service`)
- **Error Handling**: Graceful degradation - services fail silently if not configured

### Architecture Patterns
- **Service Layer**: Business logic in `services/`, exposed as singleton instances
- **API Layer**: Thin route handlers in `api/`, delegate to services
- **Storage**: JSON file-based with async file locking to prevent concurrent write issues
- **Logging**: Async queue-based logger with Socket.IO broadcast
- **Workers**: Background polling workers for Telegram listener

### Data Storage
- All data in `backend/src/storage/data/` as JSON files
- File locking prevents race conditions on concurrent writes
- Default config auto-created if files missing or invalid
- No external database required

### Testing Practices
- Unit tests for parsers, services, storage
- Integration tests for MT5 and Telegram
- E2E tests for full signal→trade→close lifecycle
- Mock external dependencies (MT5, Telegram)

---

## Key Implementation Details

### Service Initialization
Services initialize gracefully - they fail without credentials but don't crash the server:
```typescript
try {
  await telegramService.initialize();
} catch (error) {
  console.warn('Telegram service init failed:', error.message);
}
```

### JSON Storage
Files auto-create on first access to prevent ENOENT errors:
```typescript
export async function getConfig(): Promise<Config> {
  try {
    return await readJsonFile<Config>(CONFIG_FILE);
  } catch (error) {
    console.log('Creating default config.json');
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}
```

### Vite Proxy Configuration
Frontend proxies API calls to backend during development:
```typescript
server: {
  port: 3000,
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
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

### Build Output
Frontend builds to `backend/public/` so backend can serve static files in production:
```typescript
build: {
  outDir: '../backend/public',
  emptyOutDir: true
}
```

---

## Common Issues & Fixes

### TypeScript Import Errors
**Problem**: `Cannot find module '../../services/xxx'`
**Fix**: Import paths from `api/` should use `../` not `../../`

### Missing Config Files
**Problem**: `ENOENT: no such file or directory, open 'config.json'`
**Fix**: Auto-handled by json-store.ts - creates defaults if missing

### Port Conflicts
**Problem**: `EADDRINUSE: address already in use`
**Fix**: Kill process or change PORT in `.env`

### Frontend White Screen
**Problem**: Dashboard doesn't load
**Fix**: Check browser console (F12), ensure backend is running for API calls

---

## Deployment (Render)

1. Push to GitHub repository
2. Connect repo to Render dashboard
3. `render.yaml` auto-detected
4. Build command: `cd backend && npm install && npm run build && cd ../frontend && npm install && npm run build`
5. Start command: `cd backend && npm start`
6. Cron keeps service alive on free tier

---

## Agent Guidelines

### When Working on This Project

**Backend Changes:**
- Always maintain TypeScript strict mode compatibility
- Use relative imports correctly (`../` from `api/`, not `../../`)
- Services should fail gracefully, not crash the server
- JSON storage handles missing files automatically

**Frontend Changes:**
- Vite proxies `/api` and `/socket.io` to backend
- Build output goes to `backend/public/`
- Use TailwindCSS custom theme colors (trade-black, trade-green, etc.)

**Testing:**
- Run `npm test` in backend to verify changes
- Tests expect graceful service initialization
- Coverage thresholds must be met

**Environment:**
- `.env` file created from `.env.example`
- Default config auto-generated in `backend/src/storage/data/config.json`
- Services show as disconnected until credentials configured

---

## Quick Reference Commands

```bash
# Development
start-dev.bat                        # Windows quick start
cd backend && npm run dev            # Backend only
cd frontend && npm run dev           # Frontend only

# Testing
cd backend && npm test               # Run tests with coverage
cd backend && npm run test:watch     # Watch mode

# Production
cd frontend && npm run build         # Build frontend
cd backend && npm run build          # Build backend
cd backend && npm start              # Start production server

# Diagnostics
diagnostic.bat                       # System check
npx tsc --noEmit                     # TypeScript check (backend)
```

---

## Documentation Files

- `README.md` - Main project documentation
- `TESTING-GUIDE.md` - Comprehensive troubleshooting guide
- `TESTING-PROMPT.md` - Testing scenarios and checklists
- `FIXES-APPLIED.md` - History of applied fixes
- `QWEN.md` - This file (project context for AI agents)
