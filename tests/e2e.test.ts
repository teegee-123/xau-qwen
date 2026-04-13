import { messageParser } from '../backend/src/services/message-parser';
import { tradeManager } from '../backend/src/services/trade-manager';
import * as jsonStore from '../backend/src/storage/json-store';
import { oandaService } from '../backend/src/services/oanda.service';

// Mock all dependencies
jest.mock('../backend/src/storage/json-store');
jest.mock('../backend/src/services/oanda.service');
jest.mock('../backend/src/services/logger.service');

const STRATEGY_ID = 'strat-e2e-001';

const mockStrategy = {
  id: STRATEGY_ID,
  name: 'E2E Strategy',
  isActive: true,
  channels: ['-1001234567890'],
  trading: {
    lotSize: 0.01,
    symbol: 'XAU_USD',
    closeTimeoutMinutes: 3,
    maxRetries: 3,
    retryDelayMs: 2000,
    trailingStopDistance: 0,
    listenToReplies: false
  }
};

function setupStrategyMocks() {
  (jsonStore.getStrategies as jest.Mock).mockResolvedValue([mockStrategy]);
  (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(mockStrategy);
  (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
    id === STRATEGY_ID ? mockStrategy : null
  );
  (jsonStore.attachStrategyNames as jest.Mock).mockImplementation(async (trades: any[]) =>
    trades.map(t => ({ ...t, strategyName: 'E2E Strategy' }))
  );
}

const mockTradeResult = {
  tradeId: 'oanda-123',
  instrument: 'XAU_USD',
  units: '10',
  price: '4617.00',
  time: new Date().toISOString()
};

const mockTrade = {
  id: 'trade-123',
  type: 'BUY' as const,
  symbol: 'XAU_USD',
  entryPrice: 4617,
  lotSize: 0.01,
  openTime: new Date().toISOString(),
  status: 'OPEN' as const,
  mode: 'LIVE' as const,
  strategyId: STRATEGY_ID,
  matchedMessage: { initial: 'Gold buy 4617' },
  retries: 0,
  telegramMessageId: 'msg-1',
  oandaTradeId: 'oanda-123'
};

describe('E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tradeManager as any).pendingTrades.clear();
    (tradeManager as any).activeTrades.clear();
    setupStrategyMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Full Flow: Message → Trade → Edit → Update → Close', () => {
    it('should handle complete trade lifecycle', async () => {
      // Setup OANDA mocks
      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);

      // Step 1: Initial message parsed
      const initialSignal = await messageParser.parseInitialMessage('Gold buy 4617');
      expect(initialSignal).not.toBeNull();
      expect(initialSignal?.price).toBe(4617);

      // Step 2: Place trade
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, '-1001234567890');
      expect(oandaService.placeMarketOrder).toHaveBeenCalled();

      // Step 3: Message edited with SL/TP
      const editedMessage = `GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690
TP
4777`;
      const editedSignal = await messageParser.parseEditedMessage(editedMessage);
      expect(editedSignal).not.toBeNull();
      expect(editedSignal?.sl).toBe(4500);
      expect(editedSignal?.tp).toBe(4690); // Lowest TP

      // Step 4: Set up trade state for edit
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.00',
        createTime: new Date().toISOString()
      }]);
      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        ...mockTrade,
        sl: 4500,
        tp: 4690
      });

      // Set up pending/active maps
      const pendingMap = (tradeManager as any).getPendingMap(STRATEGY_ID);
      pendingMap.set('msg-1', {
        messageId: 'msg-1',
        strategyId: STRATEGY_ID,
        initialMessage: 'Gold buy 4617',
        price: 4617,
        timestamp: new Date(),
        tradeId: 'trade-123'
      });
      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', mockTrade);

      // Step 5: Update trade with SL/TP
      await tradeManager.handleEditedSignal('msg-1', editedMessage, 4500, 4690);
      expect(oandaService.updateSLTP).toHaveBeenCalledWith('oanda-123', '4500', '4690');
    });
  });

  describe('Multi-Strategy: LIVE + PAPER trades from same signal', () => {
    it('should create LIVE trade for active strategy and PAPER for inactive', async () => {
      const liveStrategy = { ...mockStrategy, id: 'strat-live', isActive: true, name: 'Live' };
      const paperStrategy = { ...mockStrategy, id: 'strat-paper', isActive: false, name: 'Paper', trading: { ...mockStrategy.trading, lotSize: 0.02 } };

      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([liveStrategy, paperStrategy]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(liveStrategy);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        [liveStrategy, paperStrategy].find(s => s.id === id) || null
      );

      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue({
        tradeId: 'oanda-live',
        instrument: 'XAU_USD',
        price: '4617.00',
        time: new Date().toISOString()
      });
      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4617.00', ask: '4617.50' });
      (jsonStore.addTrade as jest.Mock)
        .mockResolvedValueOnce({ ...mockTrade, strategyId: 'strat-live', mode: 'LIVE' })
        .mockResolvedValueOnce({ ...mockTrade, strategyId: 'strat-paper', mode: 'PAPER', oandaTradeId: undefined });

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, '-1001234567890');

      // LIVE strategy should call OANDA
      expect(oandaService.placeMarketOrder).toHaveBeenCalledTimes(1);
      // PAPER strategy should use getCurrentPrice
      expect(oandaService.getCurrentPrice).toHaveBeenCalledTimes(1);
      // Two trades should be created
      expect(jsonStore.addTrade).toHaveBeenCalledTimes(2);
    });
  });

  describe('Channel Filtering', () => {
    it('should only react to signals from subscribed channels', async () => {
      const strat1 = { ...mockStrategy, id: 's1', channels: ['ch1'], isActive: true };
      const strat2 = { ...mockStrategy, id: 's2', channels: ['ch2'], isActive: false };

      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([strat1, strat2]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(strat1);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        [strat1, strat2].find(s => s.id === id) || null
      );

      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);

      // Signal from ch1 — only strat1 should react
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, 'ch1');

      expect(oandaService.placeMarketOrder).toHaveBeenCalledTimes(1);
      expect(jsonStore.addTrade).toHaveBeenCalledTimes(1);
    });
  });
});
