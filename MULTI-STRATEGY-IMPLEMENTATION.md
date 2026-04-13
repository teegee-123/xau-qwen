# Multi-Strategy Implementation Prompt

Use this prompt to guide the full implementation of the multi-strategy system.

---

## Context

The XAU Copy Trade system currently supports a single trading configuration. It needs to support **multiple named strategies** where:
- **One strategy is LIVE** (places real OANDA trades)
- **All others are PAPER** (simulated trades using the same market price data from the WebSocket price service)
- All strategies share the same Telegram auth and OANDA connection
- Each strategy has its own: name, trading config (lot size, symbol, timeout, trailing SL, listen-to-replies toggle), and channel subscriptions
- A single Telegram listener dispatches signals to all strategies that subscribe to the signal's channel

---

## Data Model

### New `strategies.json` file

```ts
interface Strategy {
  id: string;           // Auto-generated UUID (e.g. "strat-a1b2c3")
  name: string;         // User-defined (e.g. "Default", "Scalper v2")
  isActive: boolean;    // Only one can be true = the LIVE strategy
  channels: string[];   // Telegram channels this strategy listens to
  trading: {
    lotSize: number;
    symbol: string;
    closeTimeoutMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
    trailingStopDistance: number;
    listenToReplies: boolean;
  };
}
```

### Trade record changes (in `json-store.ts` Trade interface)

- Add `strategyId: string` — links every trade to its parent strategy
- Add `mode: 'LIVE' | 'PAPER'` — determined by the strategy's `isActive` at trade-open time

### Migration

On first boot with the new code:
1. Read existing `config.trading` + `config.telegram.channels`
2. Create "Default" strategy: `{ id: uuid(), name: "Default", isActive: true, channels: config.telegram.channels, trading: config.trading }`
3. Save to `strategies.json`
4. Remove `config.trading` and `config.telegram.channels` from config (data moved to strategies)
5. All existing trades get `strategyId` = Default strategy's ID, `mode: 'LIVE'`

---

## Backend Changes

### 1. `backend/src/storage/json-store.ts`

- Add `Strategy` interface
- Add strategy storage functions: `getStrategies()`, `saveStrategies()`, `addStrategy()`, `updateStrategy()`, `deleteStrategy()`, `getActiveStrategy()`
- Add `strategyId?: string` and `mode?: 'LIVE' | 'PAPER'` to Trade interface
- Update `addTrade()` to accept optional `strategyId` and `mode`
- Add migration logic that runs on first `getStrategies()` call if `strategies.json` doesn't exist

### 2. New `backend/src/api/strategies.ts`

```
GET    /api/strategies          → List all strategies
POST   /api/strategies          → Create new strategy (body: { name, channels, trading })
PUT    /api/strategies/:id      → Update strategy
DELETE /api/strategies/:id      → Delete strategy (keeps trades, doesn't delete them)
POST   /api/strategies/:id/activate → Set as live strategy (deactivates all others)
```

### 3. Updated `backend/src/api/trades.ts`

- `GET /api/trades?strategyId=xxx` → filter by strategy (optional param)
- `GET /api/trades/open?strategyId=xxx` → open trades for specific strategy
- `GET /api/trades/closed?strategyId=xxx` → closed trades for specific strategy
- `GET /api/trades/pnl-history?strategyId=xxx` → PnL chart data for specific strategy
- All responses include `strategyId`, `mode`, and resolved `strategyName`
- Register new routes in `index.ts`

### 4. `backend/src/api/config.ts`

- `GET /api/config` → returns Telegram + OANDA settings only (NO trading, NO channels)
- `PUT /api/config` → updates Telegram + OANDA only

### 5. `backend/src/services/trade-manager.ts` — Multi-strategy refactor

**Current state:**
```ts
private pendingTrades = new Map<string, PendingTrade>();
private activeTrades = new Map<string, Trade>();
```

**New state:**
```ts
private pendingTrades = new Map<string, Map<string, PendingTrade>>(); // strategyId -> messageId -> pending
private activeTrades = new Map<string, Map<string, Trade>>();         // strategyId -> tradeId -> trade
```

**Method changes:**

- **`handleInitialSignal(messageId, text, price, channelId)`**: 
  - Fetch all strategies
  - For each strategy where `channelId` is in `strategy.channels`:
    - **If strategy.isActive (LIVE)**: Call `oandaService.placeMarketOrder()` → create trade with `mode: 'LIVE'`
    - **If !strategy.isActive (PAPER)**: Get current price from `priceService.getCurrentPrice()` → create trade with `mode: 'PAPER'` (no OANDA call)
  - Each strategy creates its own independent trade

- **`handleEditedSignal(messageId, text, sl, tp)`**: 
  - For each strategy that has a trade for this messageId:
    - **LIVE**: Call `oandaService.updateSLTP()` on OANDA
    - **PAPER**: Update SL/TP in local trade record only (no OANDA call)

- **`handleSecureProfitsReply(signalMessageId)`**: 
  - For each strategy with `listenToReplies` enabled and an open trade for this messageId:
    - Get current price → calculate PnL
    - **LIVE**: If PnL > 0, call `closeTradeManually()` → closes via OANDA
    - **PAPER**: If PnL > 0, mark trade closed with current price, calculate PnL locally

- **`closeTradeManually(tradeId, strategyId?)`**: 
  - Find trade (optionally scoped to strategyId)
  - **LIVE**: Close via OANDA API
  - **PAPER**: Mark closed with current price, calculate PnL

- **`restoreState()`**: 
  - Restore per-strategy pending and active trade maps
  - Filter open trades by strategyId when rebuilding maps

### 6. `backend/src/workers/telegram-listener.ts`

- **Single listener dispatches to ALL strategies**
- `handleNewMessage()` → For each strategy whose `channels` include the signal's channel → call `tradeManager.handleInitialSignal()` with the strategy context
- `handleEditedMessage()` → Call `tradeManager.handleEditedSignal()` — trade manager handles per-strategy routing internally
- `handleReplyMessage()` → Call `tradeManager.handleSecureProfitsReply()` — trade manager checks all strategies with `listenToReplies`
- The listener itself does NOT filter by channel globally; each strategy filters internally

### 7. `backend/src/services/price.service.ts`

- No structural changes needed — already broadcasts cached prices via WebSocket
- Paper trades read from same cached price data via `getCurrentPrice()`
- SL/TP + trailing SL checking in price update loop works for both LIVE and PAPER trades
- For PAPER trades: when SL/TP is hit → mark trade closed locally (no OANDA call)
- Add strategy awareness to the SL/TP checker: iterate all open trades (both LIVE and PAPER)

### 8. `backend/src/index.ts`

- Register new `/api/strategies` routes
- Update strategy initialization on boot
- Ensure migration runs before anything else starts

---

## Frontend Changes

### 9. `frontend/src/components/ConfigPanel.tsx`

**Remove:** The inline Trading section (lot size, symbol, timeout, trailing SL, listen to replies, max retries)

**Add: "Strategies" section with:**
- Card/grid list of all strategies showing:
  - Strategy name (editable inline)
  - Badge: "LIVE" (green) or "PAPER" (yellow)
  - Lot size, symbol, channels count
  - Action buttons: Edit, Delete (with confirmation modal), "Make Live" (only on non-active strategies)
- "Add Strategy" button → opens form modal with:
  - Name (text input, required)
  - Lot Size (number)
  - Symbol (text, default XAU_USD)
  - Close Timeout Minutes (number)
  - Trailing SL Distance (number, 0 = disabled)
  - Listen to Replies (toggle switch)
  - Max Retries (number)
  - Channels (comma-separated text input)

**Keep unchanged:** Telegram config section, OANDA config section

### 10. `frontend/src/App.tsx`

- Fetch strategies on mount alongside config
- Manage `selectedStrategyId` state:
  - Initialize from `localStorage.getItem('xau-selected-strategy')`
  - If not found or invalid, default to the strategy with `isActive: true`
- Pass `selectedStrategyId` to trade table components
- Pass `selectedStrategyId` to API fetch calls as `?strategyId=` query param
- Save to localStorage whenever selection changes

### 11. New `frontend/src/components/StrategySelector.tsx`

```tsx
interface StrategySelectorProps {
  strategies: Strategy[];
  selectedId: string;
  onChange: (id: string) => void;
}
```

- Renders a `<select>` dropdown with options:
  - "All Strategies" (value: "all")
  - Each strategy by name
- Persisted selection in localStorage
- Styled to match the existing dark trading theme

### 12. `frontend/src/components/OpenTrades.tsx`

- Accept `selectedStrategyId` prop
- Fetch trades with `?strategyId=` query param (or filter client-side)
- Each trade row shows: **strategy name badge** + **LIVE** (green) or **PAPER** (yellow) badge
- All existing functionality preserved (close button, PnL display, peak price)

### 13. `frontend/src/components/TradeHistory.tsx`

- Accept `selectedStrategyId` prop
- Fetch trades with `?strategyId=` query param (or filter client-side)
- Same badge display as OpenTrades
- All existing functionality preserved (PnL chart, sorting, etc.)

### 14. `frontend/src/components/ConfigPanel.tsx` — TypeScript interface

- Add `Strategy` interface to match backend
- Update `Config` interface to remove `trading` and `telegram.channels` (or keep for backward compat during migration)

---

## API Endpoints Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/strategies` | List all strategies |
| POST | `/api/strategies` | Create new strategy |
| PUT | `/api/strategies/:id` | Update strategy |
| DELETE | `/api/strategies/:id` | Delete strategy (keeps trades) |
| POST | `/api/strategies/:id/activate` | Set as live strategy |
| GET | `/api/config` | Telegram + OANDA config |
| PUT | `/api/config` | Update Telegram + OANDA |
| GET | `/api/trades?strategyId=x` | All trades (filtered) |
| GET | `/api/trades/open?strategyId=x` | Open trades (filtered) |
| GET | `/api/trades/closed?strategyId=x` | Closed trades (filtered) |
| GET | `/api/trades/pnl-history?strategyId=x` | PnL chart data (filtered) |

---

## Paper Trade Lifecycle

Paper trades are stored in `trades.json` alongside live trades:

- **Open**: Entry price = current market price from `priceService.getCurrentPrice()` (cached WebSocket price, no OANDA call)
- **SL/TP update**: Stored locally in trade record, checked against live price updates from price service
- **Trailing SL**: Same logic as live — price service tracks peak and trails SL
- **Close triggers**: SL hit, TP hit, "secure ur Profits" reply (if in profit), manual close, timeout
- **PnL calculation**: Same formula as live: `(closePrice - entryPrice) * lotSize * 100`
- **Peak price tracking**: Same as live via `priceService.getTradePeakPrice()`
- **Server restart**: Paper trades restore from `trades.json`, price service resumes SL/TP checking

---

## Iterative Testing Checklist

After implementation, test each scenario and iterate until ALL pass:

### Phase 1: Migration & Config
1. **Migration**: Start app with existing old config → "Default" strategy created automatically → old trades visible with "Default" badge and "LIVE" mode
2. **Create strategy**: Add "Paper Scalper" with lotSize=0.02, different channels → appears in list → saved correctly
3. **Edit strategy**: Change name/lot size → updates persist → UI reflects changes
4. **Switch live**: Click "Make Live" on "Paper Scalper" → "Default" becomes PAPER, "Paper Scalper" becomes LIVE → badges update in UI
5. **Delete strategy**: Delete a paper strategy → removed from list → its trades still appear with "Deleted" as strategy name

### Phase 2: Signal Processing
6. **Signal → all strategies react**: Send "Gold buy 4617" to a channel that ALL strategies subscribe to → LIVE strategy opens real OANDA trade, each PAPER strategy opens simulated trade at the same price → all trades visible in tables with correct badges
7. **Signal → channel filtered**: Send signal to a channel only "Default" subscribes to → only "Default" opens a trade → other strategies ignore
8. **Signal → no matching channel**: Send signal to a channel no strategy subscribes to → no trades opened

### Phase 3: Trade Lifecycle
9. **Edit → SL/TP**: Edit the signal message with SL/TP → LIVE trade updated on OANDA (verify via OANDA dashboard), PAPER trades updated locally → both show SL/TP in tables
10. **Reply → close in profit**: Reply "secure ur Profits" to the signal → LIVE strategy closes trade via OANDA if in profit, PAPER strategies close locally if in profit → all closed with correct PnL
11. **Reply → not in profit**: Reply when trade is losing → trade stays open, skip logged → reply can trigger again later when trade becomes profitable
12. **Trailing SL on paper**: Enable trailing SL on a paper strategy → price rises → SL trails → price drops → SL hits → paper trade closes at correct SL price
13. **Timeout on paper**: Paper trade receives no edit → auto-closes after `closeTimeoutMinutes` → PnL calculated at close price

### Phase 4: UI & Filtering
14. **Trade table filter**: Select "Paper Scalper" from dropdown → Open Trades shows only Paper Scalper's open trades, Trade History shows only Paper Scalper's closed trades → reload page → selection persists
15. **Default selection**: No localStorage → defaults to the LIVE strategy → tables show live strategy's trades
16. **Badges**: Each trade row shows strategy name + LIVE (green) or PAPER (yellow) badge → correct on both open and closed tables

### Phase 5: Resilience
17. **Server restart**: Stop and restart server → paper trades restore correctly → SL/TP checking resumes → active strategy is correct → no duplicate trades created
18. **Multiple paper strategies**: Create 3 paper strategies + 1 live → send signal to all their channels → 4 trades open (1 live, 3 paper) → each independent with own lot size
19. **Paper PnL accuracy**: Compare paper trade PnL with equivalent live trade formula → must match exactly
20. **Config persistence**: Change strategy settings → restart server → settings preserved

### Phase 6: Edge Cases
21. **Delete active strategy**: Attempting to delete the LIVE strategy → should either prevent it or prompt to switch live first
22. **Empty strategies list**: All strategies deleted → system handles gracefully (no crashes, shows empty state)
23. **Duplicate strategy names**: Create two strategies with same name → both work (IDs are unique)
24. **OANDA disconnect during paper trade**: OANDA goes down → paper trades continue unaffected (they don't use OANDA)

---

## Implementation Order

Recommended order to minimize breaking changes:

1. **Data layer**: Add strategies.json storage, Strategy interface, CRUD functions, migration logic
2. **API layer**: Add `/api/strategies` endpoints, update `/api/trades` to support `?strategyId=` filter
3. **Trade manager**: Refactor to per-strategy maps, add paper trade support
4. **Listener**: Update to dispatch signals to all strategies
5. **Price service**: Add paper trade SL/TP checking
6. **Frontend config**: Add Strategies section to ConfigPanel
7. **Frontend tables**: Add strategy selector, filter trades, add badges
8. **Frontend app**: Wire up strategy fetching, state management
9. **Migration**: Test old → new migration path
10. **Testing**: Run through all 24 test scenarios, fix issues, repeat

---

## Important Notes

- The price service already caches the current bid/ask price from WebSocket streaming. Paper trades should use this cached price — they do NOT need separate polling.
- Only ONE strategy can be `isActive: true` at any time. The `POST /activate` endpoint should atomically set all others to `false`.
- Paper trades must be indistinguishable from live trades in terms of PnL calculation, peak price tracking, and SL/TP logic.
- The `listenToReplies` feature from the previous implementation should work identically for both LIVE and PAPER strategies.
- When a strategy is deleted, its trades remain in `trades.json`. The frontend should resolve `strategyName` by looking up the strategy — if not found, display "Deleted".
