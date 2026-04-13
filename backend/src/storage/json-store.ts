import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Resolve data directory relative to project root, not __dirname.
// In dev:   __dirname = backend/src/storage  → go up 2 levels to backend/, then src/storage/data
// In prod:  __dirname = backend/dist/storage → go up 2 levels to backend/, then src/storage/data
// This ensures both dev and production use the SAME data directory.
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(PROJECT_ROOT, 'src', 'storage', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const STRATEGIES_FILE = path.join(DATA_DIR, 'strategies.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// File lock map to prevent concurrent writes
const fileLocks = new Map<string, Promise<any>>();

async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const existingLock = fileLocks.get(filePath);
  
  const newLock = (async () => {
    if (existingLock) {
      await existingLock;
    }
    return await operation();
  })();
  
  fileLocks.set(filePath, newLock);
  
  try {
    return await newLock;
  } finally {
    if (fileLocks.get(filePath) === newLock) {
      fileLocks.delete(filePath);
    }
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data);
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await withFileLock(filePath, async () => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  });
}

export async function appendJsonFile<T>(filePath: string, item: T): Promise<void> {
  await withFileLock(filePath, async () => {
    const data = await readJsonFile<T[]>(filePath);
    data.push(item);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  });
}

// Trade operations
export interface Trade {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  entryPrice: number;
  sl?: number;
  tp?: number;
  lotSize: number;
  openTime: string;
  closeTime?: string;
  closePrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED';
  mode: 'LIVE' | 'PAPER'; // Live = real OANDA trade, Paper = simulated
  strategyId: string; // Links trade to its parent strategy
  strategyName?: string; // Resolved name for display (not stored, added at API layer)
  matchedMessage: {
    initial: string;
    edited?: string;
  };
  retries: number;
  channelId?: string;
  // Persistence fields for restart recovery
  telegramMessageId?: string; // Telegram message ID for edit matching
  timeoutUntil?: string; // ISO timestamp for auto-close timeout
  pendingEdit?: string; // Store pending edited message content
  // OANDA integration
  oandaTradeId?: string; // OANDA trade ID for API operations
  // Trailing stop loss
  trailingStopDistance?: number; // Distance in points for trailing SL (0 = disabled)
  // Price tracking
  peakPrice?: number; // Highest price reached during trade life (All Time High)
  // Close tracking
  closeReason?: string; // Why the trade was closed: "SL Hit", "TP Hit", "Manual Close", "Timeout", "Secure Profits Reply"
}

export async function getTrades(): Promise<Trade[]> {
  try {
    return await readJsonFile<Trade[]>(TRADES_FILE);
  } catch (error) {
    // File doesn't exist, create empty array
    await saveTrades([]);
    return [];
  }
}

export async function saveTrades(trades: Trade[]): Promise<void> {
  await writeJsonFile(TRADES_FILE, trades);
}

export async function addTrade(trade: Omit<Trade, 'id'>): Promise<Trade> {
  const trades = await getTrades();
  const newTrade: Trade = { ...trade, id: uuidv4() };

  // Ensure required fields have defaults
  if (!newTrade.strategyId) {
    const activeStrategy = await getActiveStrategy();
    newTrade.strategyId = activeStrategy?.id || 'unknown';
  }
  if (!newTrade.mode) {
    const strategy = await getStrategyById(newTrade.strategyId);
    newTrade.mode = strategy?.isActive ? 'LIVE' : 'PAPER';
  }

  trades.push(newTrade);
  await saveTrades(trades);
  return newTrade;
}

export async function updateTrade(id: string, updates: Partial<Trade>): Promise<Trade | null> {
  const trades = await getTrades();
  const index = trades.findIndex(t => t.id === id);
  if (index === -1) return null;
  
  trades[index] = { ...trades[index], ...updates };
  await saveTrades(trades);
  return trades[index];
}

export async function getOpenTrades(): Promise<Trade[]> {
  const trades = await getTrades();
  return trades.filter(t => t.status === 'OPEN');
}

export async function getOpenTradesByStrategy(strategyId?: string): Promise<Trade[]> {
  const trades = await getOpenTrades();
  if (!strategyId) return trades;
  return trades.filter(t => t.strategyId === strategyId);
}

export async function getClosedTrades(): Promise<Trade[]> {
  const trades = await getTrades();
  return trades.filter(t => t.status === 'CLOSED');
}

export async function getClosedTradesByStrategy(strategyId?: string): Promise<Trade[]> {
  const trades = await getClosedTrades();
  if (!strategyId) return trades;
  return trades.filter(t => t.strategyId === strategyId);
}

export async function getTradesByStrategy(strategyId?: string): Promise<Trade[]> {
  const trades = await getTrades();
  if (!strategyId) return trades;
  return trades.filter(t => t.strategyId === strategyId);
}

/**
 * Resolve strategy names onto trade objects for API responses
 */
export async function attachStrategyNames(trades: Trade[]): Promise<Trade[]> {
  const strategies = await getStrategies();
  const strategyMap = new Map<string, string>();
  strategies.forEach(s => strategyMap.set(s.id, s.name));

  return trades.map(trade => {
    const currentStrategyName = strategyMap.get(trade.strategyId);
    // If strategy still exists, use its current name
    // If deleted, use the stored name + (Deleted) suffix
    const strategyName = currentStrategyName || (trade.strategyName ? `${trade.strategyName}(Deleted)` : 'Unknown(Deleted)');
    return {
      ...trade,
      strategyName
    };
  });
}

// Log operations
export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'message_received' | 'message_ignored' | 'trade_opened' | 'trade_updated' | 'trade_closed' | 'retry_attempt';
  message: string;
  details?: any;
}

export async function getLogs(): Promise<LogEntry[]> {
  try {
    return await readJsonFile<LogEntry[]>(LOGS_FILE);
  } catch (error) {
    // File doesn't exist, create empty array
    await writeJsonFile(LOGS_FILE, []);
    return [];
  }
}

export async function addLog(log: Omit<LogEntry, 'id' | 'timestamp'>): Promise<LogEntry> {
  const newLog: LogEntry = {
    ...log,
    id: uuidv4(),
    timestamp: new Date().toISOString()
  };
  await appendJsonFile(LOGS_FILE, newLog);
  return newLog;
}

// Config operations
export interface Config {
  telegram: {
    phoneNumber: string;
    apiId: string;
    apiHash: string;
    channels?: string[]; // Legacy: kept for migration only, channels moved to strategies
    isAuthenticated: boolean;
    authState: 'disconnected' | 'code_sent' | 'authenticated';
    phoneCodeHash?: string;
    sessionString?: string;
  };
  oanda: {
    accountId: string;
    token: string;
    environment: 'practice' | 'live';
    lastTestedAt?: string;
    lastTestResult?: { success: boolean; message: string };
  };
  // Legacy: trading config moved to strategies, kept for migration only
  trading?: {
    lotSize: number;
    symbol: string;
    closeTimeoutMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
    trailingStopDistance: number;
    listenToReplies: boolean;
  };
  messages: {
    initialPattern: string;
    editedPattern: string;
  };
  listener: {
    isActive: boolean;
  };
}

const DEFAULT_CONFIG: Config = {
  telegram: {
    phoneNumber: '',
    apiId: '',
    apiHash: '',
    channels: [], // Legacy
    isAuthenticated: false,
    authState: 'disconnected'
  },
  oanda: {
    accountId: '101-001-39008552-001',
    token: '31f824aa4f829bfc79d8ef0b4f3b6db3-9af3b2abc6d8889386f8e6bae5b60d34',
    environment: 'practice'
  },
  trading: { // Legacy, used only for migration
    lotSize: 0.01,
    symbol: 'XAU_USD',
    closeTimeoutMinutes: 3,
    maxRetries: 3,
    retryDelayMs: 2000,
    trailingStopDistance: 0,
    listenToReplies: false
  },
  messages: {
    initialPattern: '',
    editedPattern: ''
  },
  listener: {
    isActive: false
  }
};

export async function getConfig(): Promise<Config> {
  try {
    let config = await readJsonFile<Config>(CONFIG_FILE);

    // Merge environment variables (for Render deployment and local .env)
    // Env vars take priority over config.json values
    if (process.env.TELEGRAM_API_ID) {
      config.telegram.apiId = process.env.TELEGRAM_API_ID;
    }
    if (process.env.TELEGRAM_API_HASH) {
      config.telegram.apiHash = process.env.TELEGRAM_API_HASH;
    }
    if (process.env.TELEGRAM_PHONE) {
      config.telegram.phoneNumber = process.env.TELEGRAM_PHONE;
    }
    if (process.env.OANDA_ACCOUNT_ID) {
      config.oanda.accountId = process.env.OANDA_ACCOUNT_ID;
    }
    if (process.env.OANDA_TOKEN) {
      config.oanda.token = process.env.OANDA_TOKEN;
    }
    if (process.env.OANDA_ENVIRONMENT) {
      config.oanda.environment = process.env.OANDA_ENVIRONMENT as 'practice' | 'live';
    }
    if (process.env.TRADING_LOT_SIZE && config.trading) {
      config.trading.lotSize = parseFloat(process.env.TRADING_LOT_SIZE);
    }
    if (process.env.TRADING_SYMBOL && config.trading) {
      config.trading.symbol = process.env.TRADING_SYMBOL;
    }
    if (process.env.TRADING_CLOSE_TIMEOUT_MINUTES && config.trading) {
      config.trading.closeTimeoutMinutes = parseInt(process.env.TRADING_CLOSE_TIMEOUT_MINUTES);
    }
    if (process.env.TRAILING_STOP_DISTANCE && config.trading) {
      config.trading.trailingStopDistance = parseFloat(process.env.TRAILING_STOP_DISTANCE) || 0;
    }
    if (process.env.TELEGRAM_CHANNELS && config.telegram) {
      config.telegram.channels = process.env.TELEGRAM_CHANNELS.split(',').map(c => c.trim()).filter(c => c);
    }

    return config;
  } catch (error) {
    // File doesn't exist or is invalid, create default
    console.log('Creating default config.json');
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await writeJsonFile(CONFIG_FILE, config);
}

export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const config = await getConfig();
  const updated = { ...config, ...updates };
  await saveConfig(updated);
  return updated;
}

export async function clearTrades(): Promise<void> {
  await writeJsonFile(TRADES_FILE, []);
  console.log('[Storage] All trades cleared');
}

export async function clearLogs(): Promise<void> {
  await writeJsonFile(LOGS_FILE, []);
  console.log('[Storage] All logs cleared');
}

// ============================================================
// Strategy storage
// ============================================================

export interface Strategy {
  id: string;
  name: string;
  isActive: boolean; // True = this is the LIVE strategy
  channels: string[]; // Telegram channels this strategy listens to
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

const DEFAULT_STRATEGY_TRADING = {
  lotSize: 0.01,
  symbol: 'XAU_USD',
  closeTimeoutMinutes: 3,
  maxRetries: 3,
  retryDelayMs: 2000,
  trailingStopDistance: 0,
  listenToReplies: false
};

async function migrateToStrategies(): Promise<Strategy[]> {
  console.log('[Storage] Running migration: creating strategies from old config');
  try {
    const config = await getConfig();

    // Create Default strategy from old config
    const defaultStrategy: Strategy = {
      id: 'strat-default-001',
      name: 'Default',
      isActive: true,
      channels: config.telegram.channels || [],
      trading: {
        lotSize: config.trading?.lotSize ?? 0.01,
        symbol: config.trading?.symbol ?? 'XAU_USD',
        closeTimeoutMinutes: config.trading?.closeTimeoutMinutes ?? 3,
        maxRetries: config.trading?.maxRetries ?? 3,
        retryDelayMs: config.trading?.retryDelayMs ?? 2000,
        trailingStopDistance: config.trading?.trailingStopDistance ?? 0,
        listenToReplies: config.trading?.listenToReplies ?? false
      }
    };

    // Save strategies
    await saveStrategies([defaultStrategy]);

    // Update all existing trades to have strategyId and mode
    const trades = await getTrades();
    const updatedTrades = trades.map(t => ({
      ...t,
      strategyId: defaultStrategy.id,
      mode: 'LIVE' as const
    }));
    await saveTrades(updatedTrades);

    console.log('[Storage] Migration complete: created "Default" strategy, updated', trades.length, 'trades');
    return [defaultStrategy];
  } catch (error: any) {
    console.error('[Storage] Migration failed:', error.message);
    // Create minimal default even if migration fails
    const fallback: Strategy = {
      id: 'strat-default-001',
      name: 'Default',
      isActive: true,
      channels: [],
      trading: { ...DEFAULT_STRATEGY_TRADING }
    };
    await saveStrategies([fallback]);
    return [fallback];
  }
}

export async function getStrategies(): Promise<Strategy[]> {
  try {
    const strategies = await readJsonFile<Strategy[]>(STRATEGIES_FILE);

    // Ensure at least one active strategy exists
    const hasActive = strategies.some(s => s.isActive);
    if (!hasActive && strategies.length > 0) {
      strategies[0].isActive = true;
      await saveStrategies(strategies);
    }

    return strategies;
  } catch (error) {
    // File doesn't exist - run migration to create from old config
    return await migrateToStrategies();
  }
}

export async function saveStrategies(strategies: Strategy[]): Promise<void> {
  // Ensure exactly one strategy is active
  const activeCount = strategies.filter(s => s.isActive).length;
  if (activeCount > 1) {
    // Keep only the first active one
    let firstActiveSet = false;
    for (const s of strategies) {
      if (s.isActive) {
        if (firstActiveSet) {
          s.isActive = false;
        }
        firstActiveSet = true;
      }
    }
  } else if (activeCount === 0 && strategies.length > 0) {
    strategies[0].isActive = true;
  }

  await writeJsonFile(STRATEGIES_FILE, strategies);
}

export async function addStrategy(strategy: Omit<Strategy, 'id'>): Promise<Strategy> {
  const strategies = await getStrategies();
  const newStrategy: Strategy = { ...strategy, id: uuidv4() };
  strategies.push(newStrategy);
  await saveStrategies(strategies);
  return newStrategy;
}

export async function updateStrategy(id: string, updates: Partial<Strategy>): Promise<Strategy | null> {
  const strategies = await getStrategies();
  const index = strategies.findIndex(s => s.id === id);
  if (index === -1) return null;

  strategies[index] = { ...strategies[index], ...updates };

  // If setting this strategy as active, deactivate all others
  if (updates.isActive === true) {
    for (let i = 0; i < strategies.length; i++) {
      if (i !== index) {
        strategies[i].isActive = false;
      }
    }
  }

  await saveStrategies(strategies);
  return strategies[index];
}

export async function deleteStrategy(id: string): Promise<boolean> {
  const strategies = await getStrategies();

  // Prevent deleting the only active strategy
  const activeStrategy = strategies.find(s => s.isActive);
  if (activeStrategy && activeStrategy.id === id && strategies.length === 1) {
    throw new Error('Cannot delete the only active strategy');
  }

  const filtered = strategies.filter(s => s.id !== id);
  if (filtered.length === strategies.length) return false;

  await saveStrategies(filtered);

  return true;
}

export async function activateStrategy(id: string): Promise<Strategy[]> {
  const strategies = await getStrategies();
  const target = strategies.find(s => s.id === id);
  if (!target) throw new Error('Strategy not found');

  // Set all to inactive except the target
  for (const s of strategies) {
    s.isActive = s.id === id;
  }

  await saveStrategies(strategies);
  return strategies;
}

export async function getActiveStrategy(): Promise<Strategy | null> {
  const strategies = await getStrategies();
  return strategies.find(s => s.isActive) || null;
}

export async function getStrategyById(id: string): Promise<Strategy | null> {
  const strategies = await getStrategies();
  return strategies.find(s => s.id === id) || null;
}

