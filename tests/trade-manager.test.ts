import { tradeManager } from '../backend/src/services/trade-manager';
import * as jsonStore from '../backend/src/storage/json-store';
import { oandaService } from '../backend/src/services/oanda.service';

// Mock dependencies
jest.mock('../backend/src/storage/json-store');
jest.mock('../backend/src/services/oanda.service');
jest.mock('../backend/src/services/logger.service');

describe('Trade Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tradeManager as any).pendingTrades.clear();
    (tradeManager as any).activeTrades.clear();
  });

  describe('handleInitialSignal', () => {
    it('should place a market buy order', async () => {
      const mockTradeResult = {
        orderId: 'order-123',
        symbol: 'XAUUSD',
        type: 'BUY' as const,
        volume: 0.01,
        openPrice: 4617,
        sl: undefined,
        tp: undefined
      };

      const mockTrade = {
        id: 'trade-123',
        type: 'BUY' as const,
        symbol: 'XAUUSD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN' as const,
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0
      };

      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: { symbol: 'XAUUSD', lotSize: 0.01, closeTimeoutMinutes: 3, maxRetries: 3, retryDelayMs: 2000 }
      });

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);

      expect(oandaService.placeMarketOrder).toHaveBeenCalledWith({
        symbol: 'XAUUSD',
        type: 'BUY',
        volume: 0.01
      });
    });

    it('should set timeout timer for auto-close', async () => {
      jest.useFakeTimers();

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

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);

      // Verify timer is set (would auto-close after 3 minutes)
      const pending = (tradeManager as any).pendingTrades.get('msg-1');
      expect(pending.timeoutTimer).toBeDefined();

      jest.useRealTimers();
    });
  });

  describe('handleEditedSignal', () => {
    it('should update SL/TP for pending trade', async () => {
      const mockTrade = {
        id: 'trade-123',
        type: 'BUY' as const,
        symbol: 'XAUUSD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN' as const,
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0
      };

      (tradeManager as any).pendingTrades.set('msg-1', {
        messageId: 'msg-1',
        initialMessage: 'Gold buy 4617',
        price: 4617,
        timestamp: new Date(),
        tradeId: 'trade-123'
      });
      (tradeManager as any).activeTrades.set('trade-123', mockTrade);
      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        ...mockTrade,
        sl: 4500,
        tp: 4690,
        matchedMessage: {
          initial: 'Gold buy 4617',
          edited: 'GOLD BUY NOW\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690'
        }
      });

      await tradeManager.handleEditedSignal('msg-1', 'GOLD BUY NOW\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690', 4500, 4690);

      expect(oandaService.updateSLTP).toHaveBeenCalledWith('trade-123', 4500, 4690);
    });

    it('should clear timeout timer after update', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const mockTimer = setTimeout(() => {}, 0);
      (tradeManager as any).pendingTrades.set('msg-1', {
        messageId: 'msg-1',
        initialMessage: 'Gold buy 4617',
        price: 4617,
        timestamp: new Date(),
        tradeId: 'trade-123',
        timeoutTimer: mockTimer
      });
      (tradeManager as any).activeTrades.set('trade-123', {
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
      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue(null);

      await tradeManager.handleEditedSignal('msg-1', 'GOLD BUY NOW', 4500, 4690);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimer);
    });
  });
});
