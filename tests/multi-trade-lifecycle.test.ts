import { messageParser } from '../backend/src/services/message-parser';
import { tradeManager } from '../backend/src/services/trade-manager';
import { priceService } from '../backend/src/services/price.service';
import * as jsonStore from '../backend/src/storage/json-store';
import { oandaService } from '../backend/src/services/oanda.service';

// Mock all external dependencies
jest.mock('../backend/src/storage/json-store');
jest.mock('../backend/src/services/oanda.service');
jest.mock('../backend/src/services/logger.service');
jest.mock('../backend/src/services/telegram.service');

const STRATEGY_ID = 'strat-multi-001';

const mockStrategy = {
  id: STRATEGY_ID,
  name: 'Multi Strategy',
  isActive: true,
  channels: ['ch1', 'ch2'],
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
    trades.map(t => ({ ...t, strategyName: 'Multi Strategy' }))
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

describe('Multi-Trade Lifecycle Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tradeManager as any).pendingTrades.clear();
    (tradeManager as any).activeTrades.clear();
    (priceService as any).tradePeakPrices?.clear();
    setupStrategyMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ===== MESSAGE PARSING TESTS =====
  describe('Message Parsing', () => {
    describe('Initial Signal Parsing', () => {
      it('should parse simple "Gold buy {price}" message', async () => {
        const result = await messageParser.parseInitialMessage('Gold buy 4617');
        expect(result).not.toBeNull();
        expect(result!.price).toBe(4617);
        expect(result!.type).toBe('BUY');
      });

      it('should parse price with decimals', async () => {
        const result = await messageParser.parseInitialMessage('Gold buy 4617.50');
        expect(result).not.toBeNull();
        expect(result!.price).toBe(4617.5);
      });

      it('should reject message with extra text (strict format)', async () => {
        const result = await messageParser.parseInitialMessage('Gold buy 4617 now!');
        expect(result).toBeNull();
      });

      it('should ignore sell messages', async () => {
        expect(messageParser.shouldIgnore('Gold sell 4617')).toBe(true);
        const result = await messageParser.parseInitialMessage('Gold sell 4617');
        expect(result).toBeNull();
      });

      it('should ignore messages without gold/xau', async () => {
        expect(messageParser.shouldIgnore('Buy 4617')).toBe(true);
        const result = await messageParser.parseInitialMessage('Buy 4617');
        expect(result).toBeNull();
      });
    });

    describe('Edited Message Parsing', () => {
      const editedMessage = `GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690
TP
4777`;

      it('should parse edited message with SL and multiple TPs', async () => {
        const result = await messageParser.parseEditedMessage(editedMessage);
        expect(result).not.toBeNull();
        expect(result!.sl).toBe(4500);
        expect(result!.tp).toBe(4690);
        expect(result!.entryMin).toBe(4685);
        expect(result!.entryMax).toBe(4681);
      });

      it('should use lowest TP when multiple TPs provided', async () => {
        const result = await messageParser.parseEditedMessage(`GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690
TP
4777
TP
4650`);
        expect(result!.tp).toBe(4650);
      });

      it('should return null if no GOLD BUY NOW header', async () => {
        const result = await messageParser.parseEditedMessage(`
Buy @ 4685 - 4681
SL
4500
TP
4690`);
        expect(result).toBeNull();
      });

      it('should return null if SL is missing', async () => {
        const result = await messageParser.parseEditedMessage(`GOLD BUY NOW
Buy @ 4685 - 4681
TP
4690`);
        expect(result).toBeNull();
      });

      it('should return null if entry range is missing', async () => {
        const result = await messageParser.parseEditedMessage(`GOLD BUY NOW
SL
4500
TP
4690`);
        expect(result).toBeNull();
      });
    });
  });

  // ===== SINGLE TRADE LIFECYCLE =====
  describe('Single Trade Lifecycle: Signal → Trade → Edit → Close', () => {
    it('should open a trade on initial signal', async () => {
      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, 'ch1');

      expect(oandaService.placeMarketOrder).toHaveBeenCalled();
      expect(jsonStore.addTrade).toHaveBeenCalled();
    });

    it('should update SL/TP when message is edited', async () => {
      // Setup: trade already exists
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.00',
        createTime: new Date().toISOString()
      }]);
      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockResolvedValue({ ...mockTrade, sl: 4500, tp: 4690 });

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

    it('should close trade manually', async () => {
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
        status: 'CLOSED'
      }]);

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', mockTrade);

      await tradeManager.closeTradeManually('trade-123');

      expect(oandaService.closePosition).toHaveBeenCalledWith('oanda-123');
    });
  });

  // ===== MULTI-STRATEGY TESTS =====
  describe('Multi-Strategy: Same signal → Multiple trades', () => {
    it('should create trades for all strategies subscribed to the channel', async () => {
      const liveStrat = { ...mockStrategy, id: 's-live', isActive: true, name: 'Live', channels: ['ch1'] };
      const paperStrat = { ...mockStrategy, id: 's-paper', isActive: false, name: 'Paper', channels: ['ch1'], trading: { ...mockStrategy.trading, lotSize: 0.02 } };

      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([liveStrat, paperStrat]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(liveStrat);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        [liveStrat, paperStrat].find(s => s.id === id) || null
      );

      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue({
        tradeId: 'oanda-live', instrument: 'XAU_USD', price: '4617.00', time: new Date().toISOString()
      });
      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4617.00', ask: '4617.50' });
      (jsonStore.addTrade as jest.Mock)
        .mockResolvedValueOnce({ ...mockTrade, strategyId: 's-live', mode: 'LIVE' })
        .mockResolvedValueOnce({ ...mockTrade, strategyId: 's-paper', mode: 'PAPER', oandaTradeId: undefined });

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, 'ch1');

      expect(oandaService.placeMarketOrder).toHaveBeenCalledTimes(1); // Only LIVE
      expect(oandaService.getCurrentPrice).toHaveBeenCalledTimes(1);  // Only PAPER
      expect(jsonStore.addTrade).toHaveBeenCalledTimes(2);             // Both
    });

    it('should NOT create trades for strategies not subscribed to the channel', async () => {
      const strat1 = { ...mockStrategy, id: 's1', isActive: true, channels: ['ch1'] };
      const strat2 = { ...mockStrategy, id: 's2', isActive: false, channels: ['ch2'] };

      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([strat1, strat2]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(strat1);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        [strat1, strat2].find(s => s.id === id) || null
      );

      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue(mockTradeResult);
      (jsonStore.addTrade as jest.Mock).mockResolvedValue(mockTrade);

      // Signal from ch3 — no strategy subscribes
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, 'ch3');

      expect(oandaService.placeMarketOrder).not.toHaveBeenCalled();
      expect(jsonStore.addTrade).not.toHaveBeenCalled();
    });
  });

  // ===== PAPER TRADE TESTS =====
  describe('Paper Trade Behavior', () => {
    it('should use current price for entry, not OANDA order', async () => {
      const paperStrat = { ...mockStrategy, id: 's-paper', isActive: false, name: 'Paper' };

      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([paperStrat]);
      (jsonStore.getActiveStrategy as jest.Mock).mockResolvedValue(null);
      (jsonStore.getStrategyById as jest.Mock).mockImplementation((id: string) =>
        id === 's-paper' ? paperStrat : null
      );

      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4620.00', ask: '4620.50' });
      (jsonStore.addTrade as jest.Mock).mockResolvedValue({
        ...mockTrade,
        strategyId: 's-paper',
        mode: 'PAPER',
        entryPrice: 4620,
        oandaTradeId: undefined
      });

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617, 'ch1');

      expect(oandaService.placeMarketOrder).not.toHaveBeenCalled();
      expect(oandaService.getCurrentPrice).toHaveBeenCalled();
      expect(jsonStore.addTrade).toHaveBeenCalled();
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
      (jsonStore.getTrades as jest.Mock).mockResolvedValue([{
        ...paperTrade,
        status: 'CLOSED'
      }]);

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', paperTrade);

      await tradeManager.closeTradeManually('trade-123');

      expect(oandaService.closePosition).not.toHaveBeenCalled();
      expect(jsonStore.updateTrade).toHaveBeenCalled();
    });
  });

  // ===== SECURE PROFITS REPLY TESTS =====
  describe('Secure Profits Reply', () => {
    it('should close trade if in profit when reply detected', async () => {
      const stratWithReply = { ...mockStrategy, trading: { ...mockStrategy.trading, listenToReplies: true } };
      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([stratWithReply]);

      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4650.00', ask: '4650.50' });
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.00',
        createTime: new Date().toISOString()
      }]);
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
        status: 'CLOSED'
      }]);

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', { ...mockTrade, telegramMessageId: 'msg-1' });

      await tradeManager.handleSecureProfitsReply('msg-1');

      expect(oandaService.closePosition).toHaveBeenCalled();
    });

    it('should NOT close trade if not in profit', async () => {
      const stratWithReply = { ...mockStrategy, trading: { ...mockStrategy.trading, listenToReplies: true } };
      (jsonStore.getStrategies as jest.Mock).mockResolvedValue([stratWithReply]);

      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValue({ bid: '4600.00', ask: '4600.50' });

      const activeMap = (tradeManager as any).getActiveMap(STRATEGY_ID);
      activeMap.set('trade-123', { ...mockTrade, telegramMessageId: 'msg-1' });

      await tradeManager.handleSecureProfitsReply('msg-1');

      expect(oandaService.closePosition).not.toHaveBeenCalled();
    });
  });

  // ===== CHANNEL FILTERING TESTS =====
  describe('Channel Filtering', () => {
    it('should process messages from multiple channels independently', async () => {
      const channels = ['ch1', 'ch2', 'ch3'];

      for (const channelId of channels) {
        const message = `Gold buy ${4600 + parseInt(channelId.split('ch')[1])}`;
        const result = await messageParser.parseInitialMessage(message);

        expect(result).not.toBeNull();
        expect(result?.type).toBe('BUY');
        expect(result?.price).toBeGreaterThan(4600);
      }
    });

    it('should ignore sell messages from all channels', async () => {
      const channels = ['ch1', 'ch2', 'ch3'];

      for (const channelId of channels) {
        const message = `Gold sell 4617`;
        const result = await messageParser.parseInitialMessage(message);

        expect(result).toBeNull();
        expect(messageParser.shouldIgnore(message)).toBe(true);
      }
    });
  });
});
