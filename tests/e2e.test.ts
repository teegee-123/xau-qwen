import { messageParser } from '../backend/src/services/message-parser';
import { tradeManager } from '../backend/src/services/trade-manager';
import * as jsonStore from '../backend/src/storage/json-store';
import { oandaService } from '../backend/src/services/oanda.service';

// Mock all dependencies
jest.mock('../backend/src/storage/json-store');
jest.mock('../backend/src/services/oanda.service');
jest.mock('../backend/src/services/logger.service');

describe('E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tradeManager as any).pendingTrades.clear();
    (tradeManager as any).activeTrades.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Full Flow: Message → Trade → Edit → Update → Close', () => {
    it('should handle complete trade lifecycle', async async () => {
      // Setup mocks
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: { symbol: 'XAUUSD', lotSize: 0.01, closeTimeoutMinutes: 3, maxRetries: 3, retryDelayMs: 2000 }
      });
      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue({
        orderId: 'order-123',
        symbol: 'XAUUSD',
        type: 'BUY',
        volume: 0.01,
        openPrice: 4617
      });
      (jsonStore.addTrade as jest.Mock).mockResolvedValue({
        id: 'trade-123',
        type: 'BUY',
        symbol: 'XAUUSD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN',
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0
      });

      // Step 1: Initial message received
      const initialSignal = await messageParser.parseInitialMessage('Gold buy 4617');
      expect(initialSignal).not.toBeNull();
      expect(initialSignal?.price).toBe(4617);

      // Step 2: Place trade
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);
      expect(oandaService.placeMarketOrder).toHaveBeenCalled();

      // Step 3: Message edited with SL/TP
      const editedSignal = await messageParser.parseEditedMessage(`GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690
TP
4777`);
      expect(editedSignal).not.toBeNull();
      expect(editedSignal?.sl).toBe(4500);
      expect(editedSignal?.tp).toBe(4690); // Lowest TP

      // Step 4: Update trade with SL/TP
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        id: 'trade-123',
        type: 'BUY',
        symbol: 'XAUUSD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN',
        sl: 4500,
        tp: 4690,
        matchedMessage: {
          initial: 'Gold buy 4617',
          edited: 'GOLD BUY NOW\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690\nTP\n4777'
        },
        retries: 0
      });
      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);

      await tradeManager.handleEditedSignal('msg-1', editedSignal!.rawMessage, 4500, 4690);
      expect(oandaService.updateSLTP).toHaveBeenCalledWith('trade-123', 4500, 4690);
    });
  });

  describe('Timeout Scenario: No edit → Auto-close after 3 min', () => {
    it('should auto-close trade if no edit within timeout', async async () => {
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: { symbol: 'XAUUSD', lotSize: 0.01, closeTimeoutMinutes: 3, maxRetries: 3, retryDelayMs: 2000 }
      });
      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue({
        orderId: 'order-123',
        symbol: 'XAUUSD',
        type: 'BUY',
        volume: 0.01,
        openPrice: 4617
      });
      (jsonStore.addTrade as jest.Mock).mockResolvedValue({
        id: 'trade-123',
        type: 'BUY',
        symbol: 'XAUUSD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN',
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0
      });
      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: -10.50,
        closePrice: 4600
      });
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        id: 'trade-123',
        type: 'BUY',
        symbol: 'XAUUSD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        closeTime: new Date().toISOString(),
        closePrice: 4600,
        pnl: -10.50,
        pnlPercent: -0.23,
        status: 'CLOSED',
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0
      });

      // Place trade
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);

      // Advance time by 3 minutes (timeout)
      jest.advanceTimersByTime(3 * 60 * 1000);

      // Wait for async operations
      await jest.runAllTimersAsync();

      expect(oandaService.closePosition).toHaveBeenCalledWith('trade-123');
    });
  });

  describe('Multi-Channel: Same rules applied across channels', () => {
    it('should process messages from multiple channels with same rules', async async () => {
      const channels = ['channel-1', 'channel-2', 'channel-3'];

      for (const channelId of channels) {
        const message = `Gold buy ${4600 + parseInt(channelId.split('-')[1])}`;
        const result = await messageParser.parseInitialMessage(message);
        
        expect(result).not.toBeNull();
        expect(result?.type).toBe('BUY');
        expect(result?.price).toBeGreaterThan(4600);
      }
    });

    it('should ignore sell messages from all channels', async () => {
      const channels = ['channel-1', 'channel-2', 'channel-3'];

      for (const channelId of channels) {
        const message = `Gold sell 4617`;
        const result = await messageParser.parseInitialMessage(message);
        
        expect(result).toBeNull();
        expect(messageParser.shouldIgnore(message)).toBe(true);
      }
    });
  });
});
