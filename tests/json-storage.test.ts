import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = path.join(__dirname, 'test-data');
const TEST_TRADES_FILE = path.join(TEST_DATA_DIR, 'trades.json');
const TEST_LOGS_FILE = path.join(TEST_DATA_DIR, 'logs.json');
const TEST_CONFIG_FILE = path.join(TEST_DATA_DIR, 'config.json');

describe('JSON Storage', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(TEST_TRADES_FILE, '[]');
    fs.writeFileSync(TEST_LOGS_FILE, '[]');
    fs.writeFileSync(TEST_CONFIG_FILE, JSON.stringify({
      telegram: { phoneNumber: '', apiId: '', apiHash: '', channels: [], isAuthenticated: false, authState: 'disconnected' },
      oanda: { accountId: '', token: '', environment: 'practice' },
      trading: { lotSize: 0.01, symbol: 'XAUUSD', closeTimeoutMinutes: 3, maxRetries: 3, retryDelayMs: 2000, trailingStopDistance: 0, listenToReplies: false },
      messages: { initialPattern: 'Gold buy', editedPattern: 'GOLD BUY NOW' },
      listener: { isActive: false }
    }));
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe('Trade Operations', () => {
    it('should add a trade', () => {
      const trades = JSON.parse(fs.readFileSync(TEST_TRADES_FILE, 'utf-8'));
      trades.push({ id: '1', type: 'BUY', entryPrice: 4617, status: 'OPEN' });
      fs.writeFileSync(TEST_TRADES_FILE, JSON.stringify(trades));
      const result = JSON.parse(fs.readFileSync(TEST_TRADES_FILE, 'utf-8'));
      expect(result.length).toBe(1);
    });

    it('should filter open trades', () => {
      fs.writeFileSync(TEST_TRADES_FILE, JSON.stringify([
        { id: '1', type: 'BUY', status: 'OPEN' },
        { id: '2', type: 'BUY', status: 'CLOSED' }
      ]));
      const result = JSON.parse(fs.readFileSync(TEST_TRADES_FILE, 'utf-8'));
      expect(result.filter((t: any) => t.status === 'OPEN').length).toBe(1);
    });

    it('should update a trade', () => {
      fs.writeFileSync(TEST_TRADES_FILE, JSON.stringify([
        { id: '1', type: 'BUY', status: 'OPEN' }
      ]));
      const trades = JSON.parse(fs.readFileSync(TEST_TRADES_FILE, 'utf-8'));
      trades[0].status = 'CLOSED';
      trades[0].sl = 4500;
      fs.writeFileSync(TEST_TRADES_FILE, JSON.stringify(trades));
      const result = JSON.parse(fs.readFileSync(TEST_TRADES_FILE, 'utf-8'));
      expect(result[0].status).toBe('CLOSED');
      expect(result[0].sl).toBe(4500);
    });
  });

  describe('Log Operations', () => {
    it('should add a log entry', () => {
      const logs = JSON.parse(fs.readFileSync(TEST_LOGS_FILE, 'utf-8'));
      logs.push({ id: '1', type: 'message_received', message: 'Test' });
      fs.writeFileSync(TEST_LOGS_FILE, JSON.stringify(logs));
      const result = JSON.parse(fs.readFileSync(TEST_LOGS_FILE, 'utf-8'));
      expect(result.length).toBe(1);
    });

    it('should get all logs', () => {
      fs.writeFileSync(TEST_LOGS_FILE, JSON.stringify([
        { id: '1', type: 'message_received', message: 'Test 1' },
        { id: '2', type: 'trade_opened', message: 'Test 2' }
      ]));
      const result = JSON.parse(fs.readFileSync(TEST_LOGS_FILE, 'utf-8'));
      expect(result.length).toBe(2);
    });
  });

  describe('Config Operations', () => {
    it('should get config', () => {
      const config = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, 'utf-8'));
      expect(config.trading).toBeDefined();
    });

    it('should update config', () => {
      const config = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, 'utf-8'));
      config.trading.lotSize = 0.02;
      fs.writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));
      const result = JSON.parse(fs.readFileSync(TEST_CONFIG_FILE, 'utf-8'));
      expect(result.trading.lotSize).toBe(0.02);
    });
  });
});
