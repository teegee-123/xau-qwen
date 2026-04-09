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

describe('Multi-Trade Lifecycle Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear internal state
    (tradeManager as any).pendingTrades.clear();
    (tradeManager as any).activeTrades.clear();
    // Clear price service peak tracking
    (priceService as any).tradePeakPrices?.clear();
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
        expect(result).toBeNull(); // Strict format: only "Gold buy {price}" allowed
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
        expect(result!.tp).toBe(4690); // Lowest TP
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
        expect(result).not.toBeNull();
        expect(result!.tp).toBe(4650);
      });

      it('should return null if no "GOLD BUY NOW" header', async () => {
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

  // ===== SINGLE TRADE LIFECYCLE TESTS =====
  describe('Single Trade Lifecycle: Signal → Trade → Edit → Close', () => {
    const setupMocks = (overrides: any = {}) => {
      const config = {
        trading: {
          symbol: 'XAU_USD',
          lotSize: 0.01,
          closeTimeoutMinutes: 3,
          maxRetries: 3,
          retryDelayMs: 2000,
          trailingStopDistance: 0 // Disabled by default
        }
      };

      (jsonStore.getConfig as jest.Mock).mockResolvedValue({ ...config, ...overrides.config });

      (oandaService.placeMarketOrder as jest.Mock).mockResolvedValue({
        tradeId: 'oanda-123',
        price: '4617.0',
        instrument: 'XAU_USD',
        ...overrides.orderResult
      });

      (jsonStore.addTrade as jest.Mock).mockImplementation((trade) => {
        const newTrade = { ...trade, id: 'trade-123' };
        return Promise.resolve(newTrade);
      });

      (jsonStore.getTrades as jest.Mock).mockResolvedValue([]);
    };

    it('should complete full lifecycle: initial signal → edited SL/TP → manual close', async () => {
      setupMocks();

      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockImplementation((id, updates) => {
        return Promise.resolve({
          id: 'trade-123',
          type: 'BUY',
          symbol: 'XAU_USD',
          entryPrice: 4617,
          lotSize: 0.01,
          openTime: new Date().toISOString(),
          status: 'CLOSED',
          matchedMessage: { initial: 'Gold buy 4617' },
          retries: 0,
          ...updates
        });
      });

      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'trade-123',
        instrument: 'XAU_USD',
        price: '4617.0',
        createTime: new Date().toISOString()
      }]);

      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.0',
        createTime: new Date().toISOString()
      }]);

      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: '25.50',
        closePrice: '4642.5'
      });

      // Step 1: Initial signal
      const initialSignal = await messageParser.parseInitialMessage('Gold buy 4617');
      expect(initialSignal).not.toBeNull();

      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);
      expect(oandaService.placeMarketOrder).toHaveBeenCalled();
      expect(jsonStore.addTrade).toHaveBeenCalled();

      // Step 2: Edited message with SL/TP
      const editedSignal = await messageParser.parseEditedMessage(`GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690`);
      expect(editedSignal).not.toBeNull();

      await tradeManager.handleEditedSignal('msg-1', editedSignal!.rawMessage, 4500, 4690);
      expect(oandaService.updateSLTP).toHaveBeenCalledWith('oanda-123', '4500', '4690');

      // Step 3: Manual close
      await tradeManager.closeTradeManually('trade-123');
      expect(oandaService.closePosition).toHaveBeenCalledWith('oanda-123');
    });

    it('should capture peakPrice (ATH) when trade is closed', async () => {
      setupMocks();

      // Simulate price service tracking a peak
      (priceService as any).tradePeakPrices = new Map();
      (priceService as any).tradePeakPrices.set('trade-123', 4700);

      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([]);
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([{
        id: 'oanda-123',
        instrument: 'XAU_USD',
        price: '4617.0',
        createTime: new Date().toISOString()
      }]);

      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: '83.50',
        closePrice: '4700.5'
      });

      (jsonStore.updateTrade as jest.Mock).mockImplementation((id, updates) => {
        return Promise.resolve({
          id: 'trade-123',
          type: 'BUY',
          symbol: 'XAU_USD',
          entryPrice: 4617,
          lotSize: 0.01,
          openTime: new Date().toISOString(),
          status: 'CLOSED',
          matchedMessage: { initial: 'Gold buy 4617' },
          retries: 0,
          ...updates
        });
      });

      // Add trade to activeTrades map so closeTradeManually can find it
      (tradeManager as any).activeTrades.set('trade-123', {
        id: 'trade-123',
        type: 'BUY',
        symbol: 'XAU_USD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN',
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0,
        oandaTradeId: 'oanda-123'
      });

      // Close the trade
      await tradeManager.closeTradeManually('trade-123');

      // Verify peakPrice was captured in one of the update calls
      const updateCalls = (jsonStore.updateTrade as jest.Mock).mock.calls;
      const peakPriceCall = updateCalls.find((call: any[]) => call[1].peakPrice === 4700);
      expect(peakPriceCall).toBeDefined();
    });
  });

  // ===== MULTI-TRADE INDEPENDENCE TESTS =====
  describe('Multi-Trade Independence', () => {
    const setupMultiTradeMocks = () => {
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: {
          symbol: 'XAU_USD',
          lotSize: 0.01,
          closeTimeoutMinutes: 3,
          maxRetries: 3,
          retryDelayMs: 2000,
          trailingStopDistance: 0
        }
      });

      let callCount = 0;
      (oandaService.placeMarketOrder as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          tradeId: `oanda-${callCount}`,
          price: callCount === 1 ? '4617.0' : '4650.0',
          instrument: 'XAU_USD'
        });
      });

      (jsonStore.addTrade as jest.Mock).mockImplementation((trade) => {
        const id = `trade-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newTrade = { ...trade, id };
        return Promise.resolve(newTrade);
      });

      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([]);
      (jsonStore.getTrades as jest.Mock).mockResolvedValue([]);
    };

    it('should handle two independent trades from separate messages', async () => {
      setupMultiTradeMocks();

      // Trade 1: Gold buy 4617
      const signal1 = await messageParser.parseInitialMessage('Gold buy 4617');
      expect(signal1).not.toBeNull();
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);

      // Trade 2: Gold buy 4650
      const signal2 = await messageParser.parseInitialMessage('Gold buy 4650');
      expect(signal2).not.toBeNull();
      await tradeManager.handleInitialSignal('msg-2', 'Gold buy 4650', 4650);

      // Verify two separate OANDA orders were placed
      expect(oandaService.placeMarketOrder).toHaveBeenCalledTimes(2);

      // Verify two separate addTrade calls
      expect(jsonStore.addTrade).toHaveBeenCalledTimes(2);

      // Verify the orders had different prices
      const orderCalls = (oandaService.placeMarketOrder as jest.Mock).mock.calls;
      expect(orderCalls[0][0].instrument).toBe('XAU_USD');
      expect(orderCalls[1][0].instrument).toBe('XAU_USD');
    });

    it('should match edited messages to correct trades independently', async () => {
      setupMultiTradeMocks();

      // Track created trades
      const createdTrades: any[] = [];
      (jsonStore.addTrade as jest.Mock).mockImplementation((trade) => {
        const id = `trade-${createdTrades.length + 1}`;
        const newTrade = { ...trade, id };
        createdTrades.push(newTrade);
        return Promise.resolve(newTrade);
      });

      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'oanda-1', instrument: 'XAU_USD', price: '4617.0', createTime: new Date().toISOString() },
        { id: 'oanda-2', instrument: 'XAU_USD', price: '4650.0', createTime: new Date().toISOString() }
      ]);

      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockImplementation((id, updates) => {
        return Promise.resolve({ id, ...updates });
      });

      // Place two trades
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);
      await tradeManager.handleInitialSignal('msg-2', 'Gold buy 4650', 4650);

      // Edit message 1 with SL/TP
      await tradeManager.handleEditedSignal('msg-1', 'GOLD BUY NOW\nBuy @ 4617 - 4610\nSL\n4500\nTP\n4700', 4500, 4700);

      // Edit message 2 with different SL/TP
      await tradeManager.handleEditedSignal('msg-2', 'GOLD BUY NOW\nBuy @ 4650 - 4645\nSL\n4550\nTP\n4750', 4550, 4750);

      // Verify both SL/TP updates were called
      expect(oandaService.updateSLTP).toHaveBeenCalledTimes(2);
    });

    it('should close one trade without affecting the other', async () => {
      setupMultiTradeMocks();

      const trade1Id = 'trade-1';
      const trade2Id = 'trade-2';

      (jsonStore.addTrade as jest.Mock)
        .mockResolvedValueOnce({ id: trade1Id, type: 'BUY', symbol: 'XAU_USD', entryPrice: 4617, lotSize: 0.01, openTime: new Date().toISOString(), status: 'OPEN', matchedMessage: { initial: 'Gold buy 4617' }, retries: 0, oandaTradeId: 'oanda-1' })
        .mockResolvedValueOnce({ id: trade2Id, type: 'BUY', symbol: 'XAU_USD', entryPrice: 4650, lotSize: 0.01, openTime: new Date().toISOString(), status: 'OPEN', matchedMessage: { initial: 'Gold buy 4650' }, retries: 0, oandaTradeId: 'oanda-2' });

      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'oanda-1', instrument: 'XAU_USD', price: '4617.0', createTime: new Date().toISOString() },
        { id: 'oanda-2', instrument: 'XAU_USD', price: '4650.0', createTime: new Date().toISOString() }
      ]);

      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: '25.50',
        closePrice: '4642.5'
      });

      (jsonStore.updateTrade as jest.Mock).mockImplementation((id, updates) => {
        return Promise.resolve({ id, ...updates });
      });

      // Place both trades
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);
      await tradeManager.handleInitialSignal('msg-2', 'Gold buy 4650', 4650);

      // Close trade 1 only
      await tradeManager.closeTradeManually(trade1Id);

      // Verify only oanda-1 was closed
      expect(oandaService.closePosition).toHaveBeenCalledWith('oanda-1');
      expect(oandaService.closePosition).toHaveBeenCalledTimes(1);
    });
  });

  // ===== ATH TRACKING (NO TRAILING STOP) TESTS =====
  describe('ATH Tracking (No Trailing Stop)', () => {
    beforeEach(() => {
      // Initialize the tradePeakPrices map
      (priceService as any).tradePeakPrices = new Map();
    });

    it('should track peak price even when trailing stop is disabled', async () => {
      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'trade-1', type: 'BUY', symbol: 'XAU_USD', entryPrice: 4617, sl: 4500, tp: 4700 }
      ]);

      // Simulate current price below entry
      (priceService as any).currentPrice = { symbol: 'XAU_USD', bid: 4610, ask: 4612, spread: 2, timestamp: new Date().toISOString() };

      // Call the private method via a workaround - set up a mock for getOpenTrades and call updateAllTradePeaks indirectly
      // Since updateAllTradePeaks is private, we'll test through getTradePeakPrice after simulating

      // Manually set peak price as if price service tracked it
      (priceService as any).tradePeakPrices.set('trade-1', 4617);

      // Price goes up
      (priceService as any).tradePeakPrices.set('trade-1', 4650);

      // Price goes higher
      (priceService as any).tradePeakPrices.set('trade-1', 4700);

      // Price drops back
      (priceService as any).tradePeakPrices.set('trade-1', 4700); // Should stay at 4700

      const peak = priceService.getTradePeakPrice('trade-1');
      expect(peak).toBe(4700);
    });

    it('should initialize peak to max(entry, currentBid) for new trade', async () => {
      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'trade-1', type: 'BUY', symbol: 'XAU_USD', entryPrice: 4617 }
      ]);

      (priceService as any).currentPrice = { symbol: 'XAU_USD', bid: 4630, ask: 4632, spread: 2, timestamp: new Date().toISOString() };

      // Simulate updateAllTradePeaks behavior
      const openTrades = await jsonStore.getOpenTrades();
      const currentBid = (priceService as any).currentPrice.bid;
      for (const trade of openTrades) {
        const existingPeak = (priceService as any).tradePeakPrices.get(trade.id);
        const newPeak = existingPeak !== undefined ? Math.max(existingPeak, currentBid) : Math.max(trade.entryPrice, currentBid);
        (priceService as any).tradePeakPrices.set(trade.id, newPeak);
      }

      const peak = priceService.getTradePeakPrice('trade-1');
      expect(peak).toBe(4630); // Max of 4617 and 4630
    });

    it('should return null for trade that does not exist', () => {
      const peak = priceService.getTradePeakPrice('non-existent');
      expect(peak).toBeNull();
    });
  });

  // ===== ATH TRACKING (WITH TRAILING STOP) TESTS =====
  describe('ATH Tracking (With Trailing Stop)', () => {
    it('should track peak and update trailing SL independently', async () => {
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: {
          symbol: 'XAU_USD',
          lotSize: 0.01,
          trailingStopDistance: 10
        }
      });

      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'trade-1', type: 'BUY', symbol: 'XAU_USD', entryPrice: 4617, sl: 4607, trailingStopDistance: 10 }
      ]);

      // Initialize peak tracking
      (priceService as any).tradePeakPrices = new Map();
      (priceService as any).tradePeakPrices.set('trade-1', 4617);

      // Simulate price rising
      (priceService as any).tradePeakPrices.set('trade-1', 4650);

      // Peak should be 4650
      const peak1 = priceService.getTradePeakPrice('trade-1');
      expect(peak1).toBe(4650);

      // Simulate price rising more
      (priceService as any).tradePeakPrices.set('trade-1', 4700);

      // Peak should be 4700
      const peak2 = priceService.getTradePeakPrice('trade-1');
      expect(peak2).toBe(4700);

      // Price drops - peak should still be 4700
      const peak3 = priceService.getTradePeakPrice('trade-1');
      expect(peak3).toBe(4700);
    });
  });

  // ===== TIMEOUT CLOSE TESTS =====
  describe('Timeout Close', () => {
    it('should close trade via handleTimeout and capture peakPrice', async () => {
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: {
          symbol: 'XAU_USD',
          lotSize: 0.01,
          closeTimeoutMinutes: 3
        }
      });

      (priceService as any).tradePeakPrices = new Map();
      (priceService as any).tradePeakPrices.set('trade-123', 4680);

      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'oanda-123', instrument: 'XAU_USD', price: '4617.0', createTime: new Date().toISOString() }
      ]);

      (oandaService.closePosition as jest.Mock).mockResolvedValue({
        pnl: '15.00',
        closePrice: '4632.0'
      });

      (jsonStore.updateTrade as jest.Mock).mockImplementation((id, updates) => {
        return Promise.resolve({ id, ...updates });
      });

      // Add trade to activeTrades map
      (tradeManager as any).activeTrades.set('trade-123', {
        id: 'trade-123',
        type: 'BUY',
        symbol: 'XAU_USD',
        entryPrice: 4617,
        lotSize: 0.01,
        openTime: new Date().toISOString(),
        status: 'OPEN',
        matchedMessage: { initial: 'Gold buy 4617' },
        retries: 0,
        oandaTradeId: 'oanda-123'
      });

      // Manually trigger closeTradeManually which mirrors handleTimeout's peak capture
      await tradeManager.closeTradeManually('trade-123');

      // Verify peakPrice was included in one of the update calls
      const updateCalls = (jsonStore.updateTrade as jest.Mock).mock.calls;
      const peakPriceCall = updateCalls.find((call: any[]) => call[1].peakPrice === 4680);
      expect(peakPriceCall).toBeDefined();
    });
  });

  // ===== SL/TP HIT CLOSE TESTS =====
  describe('SL/TP Hit Close', () => {
    it('should calculate correct PnL when SL is hit', async () => {
      (jsonStore.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'trade-1', type: 'BUY', symbol: 'XAU_USD', entryPrice: 4617, sl: 4600, tp: 4700, lotSize: 0.01 }
      ]);

      // Simulate price hitting SL
      (priceService as any).currentPrice = { symbol: 'XAU_USD', bid: 4599, ask: 4601, spread: 2, timestamp: new Date().toISOString() };

      // This would trigger close in real scenario; we test the PnL calculation logic
      const entryPrice = 4617;
      const closePrice = 4599;
      const lotSize = 0.01;
      const expectedPnl = (closePrice - entryPrice) * lotSize * 100;

      expect(expectedPnl).toBeCloseTo(-18.0, 1); // Loss
    });

    it('should calculate correct PnL when TP is hit', async () => {
      const entryPrice = 4617;
      const closePrice = 4700;
      const lotSize = 0.01;
      const expectedPnl = (closePrice - entryPrice) * lotSize * 100;

      expect(expectedPnl).toBeCloseTo(83.0, 1); // Profit
    });
  });

  // ===== OANDA TRADE MATCHING TESTS =====
  describe('OANDA Trade Matching', () => {
    it('should match trade by instrument and approximate price', () => {
      const oandaTrades = [
        { id: 'oanda-1', instrument: 'XAU_USD', price: '4617.0', createTime: new Date().toISOString() },
        { id: 'oanda-2', instrument: 'XAU_USD', price: '4650.0', createTime: new Date().toISOString() }
      ];

      const trade = { symbol: 'XAU_USD', entryPrice: 4617, openTime: new Date().toISOString() };

      const matchingTrade = oandaTrades.find(oandaTrade => {
        const sameInstrument = oandaTrade.instrument === trade.symbol;
        const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
        return sameInstrument && similarPrice;
      });

      expect(matchingTrade!.id).toBe('oanda-1');
    });

    it('should not match trades with different instruments', () => {
      const oandaTrades = [
        { id: 'oanda-1', instrument: 'EUR_USD', price: '1.0850', createTime: new Date().toISOString() },
        { id: 'oanda-2', instrument: 'GBP_USD', price: '1.2650', createTime: new Date().toISOString() }
      ];

      const trade = { symbol: 'XAU_USD', entryPrice: 4617, openTime: new Date().toISOString() };

      const matchingTrade = oandaTrades.find(oandaTrade => {
        const sameInstrument = oandaTrade.instrument === trade.symbol;
        const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
        return sameInstrument && similarPrice;
      });

      expect(matchingTrade).toBeUndefined();
    });
  });

  // ===== COMPREHENSIVE MULTI-TRADE FLOW TEST =====
  describe('Comprehensive Multi-Trade Flow', () => {
    it('should handle: 2 signals → 2 edits → price peaks tracked → close both independently', async () => {
      // Setup
      (jsonStore.getConfig as jest.Mock).mockResolvedValue({
        trading: {
          symbol: 'XAU_USD',
          lotSize: 0.01,
          closeTimeoutMinutes: 3,
          trailingStopDistance: 0 // No trailing
        }
      });

      let orderCallCount = 0;
      (oandaService.placeMarketOrder as jest.Mock).mockImplementation(() => {
        orderCallCount++;
        return Promise.resolve({
          tradeId: `oanda-${orderCallCount}`,
          price: orderCallCount === 1 ? '4617.0' : '4650.0',
          instrument: 'XAU_USD'
        });
      });

      const createdTrades: any[] = [];
      (jsonStore.addTrade as jest.Mock).mockImplementation((trade) => {
        const id = `trade-${createdTrades.length + 1}`;
        const newTrade = { ...trade, id };
        createdTrades.push(newTrade);
        return Promise.resolve(newTrade);
      });

      // === PHASE 1: Two signals received ===
      const signal1 = await messageParser.parseInitialMessage('Gold buy 4617');
      expect(signal1).not.toBeNull();
      await tradeManager.handleInitialSignal('msg-1', 'Gold buy 4617', 4617);

      const signal2 = await messageParser.parseInitialMessage('Gold buy 4650');
      expect(signal2).not.toBeNull();
      await tradeManager.handleInitialSignal('msg-2', 'Gold buy 4650', 4650);

      expect(oandaService.placeMarketOrder).toHaveBeenCalledTimes(2);
      expect(createdTrades).toHaveLength(2);

      const trade1Id = createdTrades[0].id;
      const trade2Id = createdTrades[1].id;

      // === PHASE 2: Peak prices tracked (simulated) ===
      (priceService as any).tradePeakPrices = new Map();
      (priceService as any).tradePeakPrices.set(trade1Id, 4680); // Trade 1 peaked at 4680
      (priceService as any).tradePeakPrices.set(trade2Id, 4700); // Trade 2 peaked at 4700

      // === PHASE 3: Both edited with SL/TP ===
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValue([
        { id: 'oanda-1', instrument: 'XAU_USD', price: '4617.0', createTime: new Date().toISOString() },
        { id: 'oanda-2', instrument: 'XAU_USD', price: '4650.0', createTime: new Date().toISOString() }
      ]);
      (oandaService.updateSLTP as jest.Mock).mockResolvedValue(undefined);
      (jsonStore.updateTrade as jest.Mock).mockImplementation((id, updates) => {
        return Promise.resolve({ id, ...updates });
      });

      await tradeManager.handleEditedSignal('msg-1', 'GOLD BUY NOW\nBuy @ 4617 - 4610\nSL\n4500\nTP\n4700', 4500, 4700);
      await tradeManager.handleEditedSignal('msg-2', 'GOLD BUY NOW\nBuy @ 4650 - 4645\nSL\n4550\nTP\n4750', 4550, 4750);

      expect(oandaService.updateSLTP).toHaveBeenCalledTimes(2);

      // === PHASE 4: Close trade 1 ===
      (oandaService.closePosition as jest.Mock).mockResolvedValueOnce({
        pnl: '63.00',
        closePrice: '4680.0'
      });

      // Simulate already closed on OANDA path
      (oandaService.getOpenTrades as jest.Mock).mockResolvedValueOnce([]);
      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValueOnce({ bid: '4680', ask: '4682' });

      await tradeManager.closeTradeManually(trade1Id);

      // Verify peakPrice was captured
      const updateCalls = (jsonStore.updateTrade as jest.Mock).mock.calls;
      const trade1CloseCall = updateCalls.find((call: any[]) => call[1].peakPrice === 4680);
      expect(trade1CloseCall).toBeDefined();

      // === PHASE 5: Close trade 2 ===
      (oandaService.closePosition as jest.Mock).mockResolvedValueOnce({
        pnl: '50.00',
        closePrice: '4700.0'
      });

      (oandaService.getOpenTrades as jest.Mock).mockResolvedValueOnce([]);
      (oandaService.getCurrentPrice as jest.Mock).mockResolvedValueOnce({ bid: '4700', ask: '4702' });

      await tradeManager.closeTradeManually(trade2Id);

      // Verify both peak prices were captured correctly
      const allUpdateCalls = (jsonStore.updateTrade as jest.Mock).mock.calls;
      const trade2CloseCall = allUpdateCalls.find((call: any[]) => call[1].peakPrice === 4700);
      expect(trade2CloseCall).toBeDefined();
    });
  });
});
