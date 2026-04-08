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

export async function getClosedTrades(): Promise<Trade[]> {
  const trades = await getTrades();
  return trades.filter(t => t.status === 'CLOSED');
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
    channels: string[];
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
  trading: {
    lotSize: number;
    symbol: string;
    closeTimeoutMinutes: number;
    maxRetries: number;
    retryDelayMs: number;
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
    channels: [],
    isAuthenticated: false,
    authState: 'disconnected'
  },
  oanda: {
    accountId: '101-001-39008552-001',
    token: '31f824aa4f829bfc79d8ef0b4f3b6db3-9af3b2abc6d8889386f8e6bae5b60d34',
    environment: 'practice'
  },
  trading: {
    lotSize: 0.01,
    symbol: 'XAU_USD',
    closeTimeoutMinutes: 3,
    maxRetries: 3,
    retryDelayMs: 2000
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
    return await readJsonFile<Config>(CONFIG_FILE);
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
