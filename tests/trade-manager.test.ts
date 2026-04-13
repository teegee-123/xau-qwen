import { tradeManager } from '../backend/src/services/trade-manager';
import * as jsonStore from '../backend/src/storage/json-store';
import { oandaService } from '../backend/src/services/oanda.service';
import { priceService } from '../backend/src/services/price.service';

// Mock dependencies
jest.mock('../backend/src/storage/json-store');
jest.mock('../backend/src/services/oanda.service');
jest.mock('../backend/src/services/logger.service');
jest.mock('../backend/src/services/price.service');

const STRATEGY_ID = 'strat-test-001';

const mockStrategy = {
  id: STRATEGY_ID,
  name: 'Test Strategy',
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

const mockStrategies = [mockStrategy];

function setupStrategyMocks() {
  (jsonStore.getStrategies as jest.Mock).mockResolvedValue(mockStrategies);
  (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(mockStrategy);
  (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
    mockStrategies.find(s => s.id === id) || null
  );
  (jsonStore.attachStrategyNames as jest.Mock).mockImplementation(async (trades: any[]) =>
    trades.map(t => ({ ...t, strategyName: 'Test Strategy' }))
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

describe('Trade Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tradeManager as any).pendingTrades.clear();
    (tradeManager as any).activeTrades.clear();
    (priceService as any).tradePeakPrices?.clear();
    setupStrategyMocks();
  });

  describe('handleInitialSignal', () => {
    it('should place a market buy order for LIVE strategy', async () => {
      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, '-1001234567890');

      expect(oandaService.placeMarketOrder).toHaveBeenCalledWith({
        instrument: 'XAU_USD',
        units: 10,
        timeInForce: 'FOK',
        positionFill: 'DEFAULT'
      });
    });

    it('should create PAPER trade when strategy is not active', async () => {
      const paperStrategy = { ...mockStrategy, isActive: false, id: 'strat-paper' };
      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([paperStrategy]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(null);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        id === 'strat-paper' ? paperStrategy : null
      );

      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4617.00', ask: '4617.50' });
      (jsonStore.addTrade as jest.Mock).mockResolvedValue({
        ...mockTrade,
        strategyId: 'strat-paper',
        mode: 'PAPER',
        oandaTradeId: undefined
      });

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, '-1001234567890');

      // PAPER strategy should NOT call OANDA placeMarketOrder
      expect(oandaService.placeMarketOrder).not.toHaveBeenCalled();
      // Should use getCurrentPrice instead
      expect(oandaService.getCurrentPrice).toHaveBeenCalled();
    });

    it('should only react if channel is in strategy channels', async () => {
      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);

      // Signal from a channel NOT in strategy's channels
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, '-999999');

      expect(oandaService.placeMarketOrder).not.toHaveBeenCalled();
    });
  });

  describe('handleEditedSignal', () => {
    it('should update SL/TP for LIVE trade', async () => {
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
        tp: 4690,
        matchedMessage: {
          initial: 'Gold buy 4617',
          edited: 'GOLD BUY NOW\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690'
        }
      });

      // Set up pending and active trades
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

      await tradeManager.handleEditedSignal('msg-1', 'GOLD BUY NOW\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690', 4500, 4690);

      expect(oandaService.updateSLTP).toHaveBeenCalledWith('oanda-123', '4500', '4690');
    });

    it('should update PAPER trade SL/TP locally (no OANDA call)', async () => {
      const paperTrade = { ...mockTrade, mode: 'PAPER' as const, oandaTradeId: undefined };

      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        ...paperTrade,
        sl: 4500,
        tp: 4690
      });

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
      activeMap.set('trade-123', paperTrade);

      await tradeManager.handleEditedSignal('msg-1', 'GOLD BUY NOW', 4500, 4690);

      // PAPER trade should NOT call OANDA updateSLTP
      expect(oandaService.updateSLTP).not.toHaveBeenCalled();
      // But should update trade locally
      expect(jsonStore.updateTrade).toHaveBeenCalled();
    });
  });

  describe('handleSecureProfitsReply', () => {
    it('should close LIVE trade if in profit', async () => {
      const now = new Date().toISOString();
      const oandaTrade = {
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.00',
        createTime: now
      };

      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4650.00', ask: '4650.50' });
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([oandaTrade]);
      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: '33.00',
        closePrice: '4650.00'
      });
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        ...mockTrade,
        status: 'CLOSED',
        closePrice: 4650,
        pnl: 33
      });
      (jsonStore.getTrades as jest.Mock).mockResolvedValue([{
        ...mockTrade,
        status: 'CLOSED',
        closePrice: 4650,
        pnl: 33
      }]);
      (priceService.getTradePeakPrice as jest.Mock).mockReturnValue(undefined);
      (priceService.removeTradePeakPrice as jest.Mock).mockResolvedValue(undefined);

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', {
        ...mockTrade,
        telegramMessageId: 'msg-1',
        openTime: now,
        entryPrice: 4617
      });

      // mockStrategy already has listenToReplies: false, so set it to true for this test
      mockStrategy.trading.listenToReplies = true;
      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([mockStrategy]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(mockStrategy);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        id === STRATEGY_ID ? mockStrategy : null
      );

      await tradeManager.handleSecureProfitsReply('msg-1');

      expect(oandaService.closePosition).toHaveBeenCalled();
    });

    it('should skip closing if trade is NOT in profit', async () => {
      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4600.00', ask: '4600.50' });

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', { ...mockTrade, telegramMessageId: 'msg-1' });

      await tradeManager.handleSecureProfitsReply('msg-1');

      expect(oandaService.closePosition).not.toHaveBeenCalled();
    });

    it('should do nothing if listenToReplies is disabled', async () => {
      const stratNoReply = { ...mockStrategy, trading: { ...mockStrategy.trading, listenToReplies: false } };
      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([stratNoReply]);

      await tradeManager.handleSecureProfitsReply('msg-1');

      expect(oandaService.getCurrentPrice).not.toHaveBeenCalled();
    });
  });

  describe('closeTradeManually', () => {
    it('should close LIVE trade via OANDA', async () => {
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.00',
        createTime: new Date().toISOString()
      }]);
      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: '10.00',
        closePrice: '4627.00'
      });
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        ...mockTrade,
        status: 'CLOSED',
        closePrice: 4627,
        pnl: 10
      });
      (jsonStore.getTrades as jest.Mock).mockResolvedValue([{
        ...mockTrade,
        status: 'CLOSED',
        closePrice: 4627,
        pnl: 10
      }]);
      (priceService.getTradePeakPrice as jest.Mock).mockReturnValue(undefined);
      (priceService.removeTradePeakPrice as jest.Mock).mockResolvedValue(undefined);

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', mockTrade);

      await tradeManager.closeTradeManually('trade-123');

      expect(oandaService.closePosition).toHaveBeenCalledWith('oanda-123');
    });

    it('should close PAPER trade locally without OANDA call', async () => {
      const paperTrade = { ...mockTrade, mode: 'PAPER' as const, oandaTradeId: undefined };

      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4627.00', ask: '4627.50' });
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({
        ...paperTrade,
        status: 'CLOSED',
        closePrice: 4627,
        pnl: 10
      });
      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([]);
      (priceService.getTradePeakPrice as jest.Mock).mockReturnValue(undefined);
      (priceService.removeTradePeakPrice as jest.Mock).mockResolvedValue(undefined);

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', paperTrade);

      await tradeManager.closeTradeManually('trade-123');

      // PAPER trade should NOT call OANDA closePosition
      expect(oandaService.closePosition).not.toHaveBeenCalled();
      expect(jsonStore.updateTrade).toHaveBeenCalled();
    });
  });
});
