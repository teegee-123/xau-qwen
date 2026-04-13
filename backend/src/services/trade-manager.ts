import { addTrade, updateTrade, getOpenTrades, Trade, getTrades, saveTrades, getStrategyById, getStrategies, Strategy } from '../storage/json-store';
import { oandaService } from './oanda.service';
import { priceService } from './price.service';
import { logger } from './logger.service';
import { getConfig } from '../storage/json-store';

interface PendingTrade {
  messageId: string;
  strategyId: string;
  initialMessage: string;
  price: number;
  timestamp: Date;
  tradeId?: string;
  channelId?: string;
}

class TradeManager {
  // Per-strategy tracking: strategyId -> messageId -> pending
  private pendingTrades = new Map<string, Map<string, PendingTrade>>();
  // Per-strategy tracking: strategyId -> tradeId -> trade
  private activeTrades = new Map<string, Map<string, Trade>>();
  private ageCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Get or create pending trades map for a strategy
   */
  private getPendingMap(strategyId: string): Map<string, PendingTrade> {
    if (!this.pendingTrades.has(strategyId)) {
      this.pendingTrades.set(strategyId, new Map());
    }
    return this.pendingTrades.get(strategyId)!;
  }

  /**
   * Get or create active trades map for a strategy
   */
  private getActiveMap(strategyId: string): Map<string, Trade> {
    if (!this.activeTrades.has(strategyId)) {
      this.activeTrades.set(strategyId, new Map());
    }
    return this.activeTrades.get(strategyId)!;
  }

  /**
   * Restore trade state from persistent storage after server restart
   */
  async restoreState(): Promise<void> {
    try {
      const openTrades = await getTrades();

      // Filter to only OPEN trades
      const stillOpenTrades = openTrades.filter(t => t.status === 'OPEN');

      if (stillOpenTrades.length === 0) {
        await logger.log('message_received', 'No open trades to restore');
        return;
      }

      await logger.log('message_received', `Restoring ${stillOpenTrades.length} open trades from storage`);

      // Fetch open trades from OANDA to recover missing oandaTradeId values (LIVE trades only)
      let oandaTrades: any[] = [];
      try {
        oandaTrades = await oandaService.getOpenTrades();
        console.log(`[TradeManager] Fetched ${oandaTrades.length} open trades from OANDA`);
      } catch (error: any) {
        console.warn('[TradeManager] Failed to fetch OANDA trades for recovery:', error.message);
      }

      for (const trade of stillOpenTrades) {
        // Group by strategy
        const strategyId = trade.strategyId;
        const activeMap = this.getActiveMap(strategyId);
        activeMap.set(trade.id, trade);

        // For LIVE trades, try to recover oandaTradeId if missing
        if (trade.mode === 'LIVE' && !trade.oandaTradeId && oandaTrades.length > 0) {
          console.log(`[TradeManager] Trade ${trade.id} missing oandaTradeId, attempting recovery...`);

          const matchingOandaTrade = oandaTrades.find(oandaTrade => {
            const sameInstrument = oandaTrade.instrument === trade.symbol;
            const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
            const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
            return sameInstrument && (similarPrice || similarTime);
          });

          if (matchingOandaTrade) {
            console.log(`[TradeManager] Recovered oandaTradeId: ${matchingOandaTrade.id} for trade ${trade.id}`);
            trade.oandaTradeId = matchingOandaTrade.id;
            await updateTrade(trade.id, { oandaTradeId: matchingOandaTrade.id });
          } else {
            console.warn(`[TradeManager] Could not recover oandaTradeId for trade ${trade.id}`);
          }
        }
      }

      // Count total active trades across all strategies
      let totalActive = 0;
      this.activeTrades.forEach(map => totalActive += map.size);

      await logger.log('message_received', `Trade state restoration complete: ${totalActive} active across ${this.activeTrades.size} strategies`);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to restore trade state: ${error.message}`);
    }
  }

  /**
   * Handle initial buy signal - creates trades for ALL strategies that subscribe to the channel
   */
  async handleInitialSignal(messageId: string, message: string, price: number, channelId?: string): Promise<void> {
    try {
      const strategies = await getStrategies();

      // Filter strategies that subscribe to this channel
      const matchingStrategies = strategies.filter(s =>
        !channelId || s.channels.includes(channelId)
      );

      if (matchingStrategies.length === 0) {
        console.log('[TradeManager] No strategies subscribe to this channel, ignoring signal');
        return;
      }

      console.log(`[TradeManager] Signal received, dispatching to ${matchingStrategies.length} strategies`);

      for (const strategy of matchingStrategies) {
        await this.handleSignalForStrategy(messageId, message, price, strategy, channelId);
      }
    } catch (error: any) {
      await logger.log('message_ignored', `Error handling initial signal: ${error.message}`);
      console.error(`[TradeManager] Error in handleInitialSignal: ${error.message}`);
    }
  }

  /**
   * Handle signal for a single strategy (LIVE or PAPER)
   */
  private async handleSignalForStrategy(
    messageId: string,
    message: string,
    price: number,
    strategy: Strategy,
    channelId?: string
  ): Promise<void> {
    const config = await getConfig();
    const pendingMap = this.getPendingMap(strategy.id);

    // Create pending trade
    const pending: PendingTrade = {
      messageId,
      strategyId: strategy.id,
      initialMessage: message,
      price,
      timestamp: new Date(),
      channelId
    };

    pendingMap.set(messageId, pending);

    const isLive = strategy.isActive;
    const mode = isLive ? 'LIVE' : 'PAPER';

    console.log(`[TradeManager] ${mode} trade for strategy "${strategy.name}" (${strategy.id})`);

    try {
      let entryPrice: number;
      let oandaTradeId: string | undefined;

      if (isLive) {
        // LIVE: Place real market order on OANDA
        const tradeResult = await oandaService.placeMarketOrder({
          instrument: strategy.trading.symbol,
          units: strategy.trading.lotSize * 1000,
          timeInForce: 'FOK',
          positionFill: 'DEFAULT'
        });

        entryPrice = parseFloat(tradeResult.price);
        oandaTradeId = tradeResult.tradeId;

        console.log('[TradeManager] OANDA trade result:', {
          tradeId: tradeResult.tradeId,
          price: tradeResult.price
        });
      } else {
        // PAPER: Get current price from price service (no OANDA call)
        const currentPrice = await oandaService.getCurrentPrice(strategy.trading.symbol);
        if (!currentPrice) {
          console.warn('[TradeManager] No current price available for paper trade, using signal price');
          entryPrice = price;
        } else {
          entryPrice = parseFloat(currentPrice.bid);
        }
        oandaTradeId = undefined;
      }

      // Check if trailing SL is enabled
      const trailingDistance = strategy.trading.trailingStopDistance || 0;
      const useTrailingSL = trailingDistance > 0;

      // Create trade record
      const tradeData: any = {
        type: 'BUY' as const,
        symbol: strategy.trading.symbol,
        entryPrice,
        lotSize: strategy.trading.lotSize,
        openTime: new Date().toISOString(),
        status: 'OPEN' as const,
        mode: mode as 'LIVE' | 'PAPER',
        strategyId: strategy.id,
        matchedMessage: {
          initial: message
        },
        retries: 0,
        channelId,
        telegramMessageId: messageId,
        oandaTradeId,
        trailingStopDistance: trailingDistance
      };

      // If trailing SL is enabled, set initial SL and no TP
      if (useTrailingSL) {
        const initialSL = entryPrice - trailingDistance;
        tradeData.sl = initialSL;
        tradeData.tp = undefined;
        console.log(`[TradeManager] Trailing SL enabled: Initial SL=${initialSL}, Distance=${trailingDistance}`);
      }

      const trade = await addTrade(tradeData);

      // Add to active trades map
      const activeMap = this.getActiveMap(strategy.id);
      activeMap.set(trade.id, trade);

      pending.tradeId = trade.id;

      await logger.tradeOpened(trade);
      console.log(`[TradeManager] ${mode} trade opened for "${strategy.name}": ${trade.id} @ ${entryPrice}`);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to place ${mode} trade for "${strategy.name}": ${error.message}`);
      console.error(`[TradeManager] Error placing ${mode} trade for strategy ${strategy.id}:`, error.message);
      pendingMap.delete(messageId);
    }
  }

  /**
   * Handle edited signal - updates SL/TP for all strategies with matching trades
   */
  async handleEditedSignal(messageId: string, message: string, sl: number, tp: number): Promise<void> {
    console.log('[TradeManager] handleEditedSignal - MessageId:', messageId, 'SL:', sl, 'TP:', tp);

    // Find all strategies that have a pending trade for this messageId
    let updatedCount = 0;

    for (const [strategyId, pendingMap] of this.pendingTrades.entries()) {
      const pending = pendingMap.get(messageId);
      if (!pending || !pending.tradeId) continue;

      const activeMap = this.getActiveMap(strategyId);
      const trade = activeMap.get(pending.tradeId);
      if (!trade) continue;

      try {
        const strategy = await getStrategyById(strategyId);
        if (!strategy) continue;

        const trailingDistance = strategy.trading.trailingStopDistance || 0;

        if (trailingDistance > 0) {
          // Trailing SL active - ignore SL/TP from edited message
          console.log(`[TradeManager] Trailing SL active for strategy ${strategyId}, ignoring message SL/TP`);
          await logger.log('message_received', `Edited message received but trailing SL active for ${strategy.name}. Ignoring SL=${sl}, TP=${tp}`);

          await updateTrade(pending.tradeId, {
            matchedMessage: {
              ...trade.matchedMessage,
              edited: message
            }
          });
          continue;
        }

        if (trade.mode === 'LIVE') {
          // LIVE: Update SL/TP on OANDA
          const oandaTrades = await oandaService.getOpenTrades();
          const matchingOandaTrade = oandaTrades.find(oandaTrade => {
            const sameInstrument = oandaTrade.instrument === trade.symbol;
            const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
            const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
            return sameInstrument && (similarPrice || similarTime);
          });

          if (!matchingOandaTrade) {
            console.warn(`[TradeManager] Live trade ${trade.id} not found on OANDA - may already be closed`);
            await logger.log('message_ignored', `Cannot update SL/TP: Live trade ${trade.id} not found on OANDA`);
            continue;
          }

          const oandaTradeId = matchingOandaTrade.id;
          await updateTrade(trade.id, { oandaTradeId });
          trade.oandaTradeId = oandaTradeId;

          await oandaService.updateSLTP(oandaTradeId, String(sl), String(tp));
          console.log(`[TradeManager] LIVE trade ${trade.id} SL/TP updated on OANDA`);
        } else {
          // PAPER: Update SL/TP locally only
          console.log(`[TradeManager] PAPER trade ${trade.id} SL/TP updated locally`);
        }

        // Update trade record
        const updatedTrade = await updateTrade(pending.tradeId, {
          sl,
          tp,
          pendingEdit: undefined,
          matchedMessage: {
            ...trade.matchedMessage,
            edited: message
          }
        });

        if (updatedTrade) {
          activeMap.set(pending.tradeId, updatedTrade);
        }

        await logger.tradeUpdated(updatedTrade || trade);
        updatedCount++;
      } catch (error: any) {
        console.error(`[TradeManager] Error updating SL/TP for strategy ${strategyId}:`, error.message);
        await logger.log('message_ignored', `Failed to update SL/TP for strategy ${strategyId}: ${error.message}`);
      }
    }

    console.log(`[TradeManager] handleEditedSignal - Updated ${updatedCount} strategies`);
  }

  private async handleTimeout(tradeId: string, strategyId: string): Promise<void> {
    const activeMap = this.getActiveMap(strategyId);
    const trade = activeMap.get(tradeId);

    if (!trade) return;

    try {
      if (trade.mode === 'LIVE') {
        // Find on OANDA
        const oandaTrades = await oandaService.getOpenTrades();
        const matchingOandaTrade = oandaTrades.find(oandaTrade => {
          const sameInstrument = oandaTrade.instrument === trade.symbol;
          const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
          const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
          return sameInstrument && (similarPrice || similarTime);
        });

        if (!matchingOandaTrade) {
          // Already closed server-side
          await this.closeTradeLocally(tradeId, strategyId, 0, 0);
          return;
        }

        const oandaTradeId = matchingOandaTrade.id;
        await updateTrade(tradeId, { oandaTradeId });
        trade.oandaTradeId = oandaTradeId;

        const result = await oandaService.closePosition(oandaTradeId);
        let pnl = parseFloat(result.pnl);
        const closePrice = parseFloat(result.closePrice);

        if (pnl === 0 && closePrice > 0) {
          const priceDiff = closePrice - trade.entryPrice;
          pnl = priceDiff * trade.lotSize * 100;
        }

        const peakPrice = priceService.getTradePeakPrice(tradeId);
        await updateTrade(tradeId, {
          status: 'CLOSED',
          closeTime: new Date().toISOString(),
          closePrice,
          pnl,
          pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
          peakPrice: peakPrice || undefined
        });
      } else {
        // PAPER: Close locally with current price
        const currentPrice = await oandaService.getCurrentPrice(trade.symbol);
        const closePrice = currentPrice ? parseFloat(currentPrice.bid) : trade.entryPrice;
        const pnl = (closePrice - trade.entryPrice) * trade.lotSize * 100;
        const peakPrice = priceService.getTradePeakPrice(tradeId);

        await updateTrade(tradeId, {
          status: 'CLOSED',
          closeTime: new Date().toISOString(),
          closePrice,
          pnl,
          pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
          peakPrice: peakPrice || undefined
        });
      }

      activeMap.delete(tradeId);
      priceService.removeTradePeakPrice(tradeId);

      const updatedTrade = await this.getTradeById(tradeId);
      if (updatedTrade) await logger.tradeClosed(updatedTrade);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to close timed out trade: ${error.message}`);
      console.error(`[TradeManager] Error closing trade ${tradeId}:`, error.message);
    }
  }

  /**
   * Close a trade locally (helper for PAPER trades and already-closed LIVE trades)
   */
  private async closeTradeLocally(tradeId: string, strategyId: string, closePrice: number, pnl: number): Promise<void> {
    const activeMap = this.getActiveMap(strategyId);
    const trade = activeMap.get(tradeId);
    if (!trade) return;

    const peakPrice = priceService.getTradePeakPrice(tradeId);

    const updatedTrade = await updateTrade(tradeId, {
      status: 'CLOSED',
      closeTime: new Date().toISOString(),
      closePrice: closePrice || trade.entryPrice,
      pnl,
      pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
      peakPrice: peakPrice || undefined
    });

    if (updatedTrade) activeMap.delete(tradeId);
    priceService.removeTradePeakPrice(tradeId);

    if (updatedTrade) await logger.tradeClosed(updatedTrade);
  }

  /**
   * Close trade manually (user-initiated)
   */
  async closeTradeManually(tradeId: string): Promise<void> {
    // Find trade across all strategies
    for (const [strategyId, activeMap] of this.activeTrades.entries()) {
      const trade = activeMap.get(tradeId);
      if (!trade) continue;

      try {
        if (trade.mode === 'LIVE') {
          // LIVE: Close via OANDA
          const oandaTrades = await oandaService.getOpenTrades();
          const matchingOandaTrade = oandaTrades.find(oandaTrade => {
            const sameInstrument = oandaTrade.instrument === trade.symbol;
            const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
            const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
            return sameInstrument && (similarPrice || similarTime);
          });

          if (!matchingOandaTrade) {
            // Already closed server-side
            const currentPrice = await oandaService.getCurrentPrice(trade.symbol);
            const closePrice = currentPrice ? parseFloat(currentPrice.bid) : trade.entryPrice;
            const pnl = (closePrice - trade.entryPrice) * trade.lotSize * 100;
            await this.closeTradeLocally(tradeId, strategyId, closePrice, pnl);
            return;
          }

          const oandaTradeId = matchingOandaTrade.id;
          await updateTrade(tradeId, { oandaTradeId });
          trade.oandaTradeId = oandaTradeId;

          const result = await oandaService.closePosition(oandaTradeId);
          let pnl = parseFloat(result.pnl);
          const closePrice = parseFloat(result.closePrice);

          if (pnl === 0 && closePrice > 0) {
            const priceDiff = closePrice - trade.entryPrice;
            pnl = priceDiff * trade.lotSize * 100;
          }

          const peakPrice = priceService.getTradePeakPrice(tradeId);
          await updateTrade(tradeId, {
            status: 'CLOSED',
            closeTime: new Date().toISOString(),
            closePrice,
            pnl,
            pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
            peakPrice: peakPrice || undefined
          });
        } else {
          // PAPER: Close locally
          const currentPrice = await oandaService.getCurrentPrice(trade.symbol);
          const closePrice = currentPrice ? parseFloat(currentPrice.bid) : trade.entryPrice;
          const pnl = (closePrice - trade.entryPrice) * trade.lotSize * 100;
          const peakPrice = priceService.getTradePeakPrice(tradeId);

          await updateTrade(tradeId, {
            status: 'CLOSED',
            closeTime: new Date().toISOString(),
            closePrice,
            pnl,
            pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
            peakPrice: peakPrice || undefined
          });
        }

        activeMap.delete(tradeId);
        priceService.removeTradePeakPrice(tradeId);

        const updatedTrade = await this.getTradeById(tradeId);
        if (updatedTrade) await logger.tradeClosed(updatedTrade);
        return;
      } catch (error: any) {
        await logger.log('message_ignored', `Failed to close trade: ${error.message}`);
        console.error(`[TradeManager] Error closing trade ${tradeId}:`, error.message);
        throw error;
      }
    }

    throw new Error('Trade not found');
  }

  /**
   * Handle "secure ur Profits" reply message
   * Checks ALL strategies with listenToReplies enabled and open trades for the signal message
   */
  async handleSecureProfitsReply(signalMessageId: string): Promise<void> {
    try {
      const strategies = await getStrategies();

      for (const strategy of strategies) {
        // Check if listenToReplies is enabled
        if (!strategy.trading.listenToReplies) continue;

        const activeMap = this.getActiveMap(strategy.id);

        // Find open trade for this signal message
        let matchingTrade: Trade | undefined;
        let matchingTradeId: string | undefined;

        for (const [tradeId, trade] of activeMap.entries()) {
          if (trade.telegramMessageId === signalMessageId && trade.status === 'OPEN') {
            matchingTrade = trade;
            matchingTradeId = tradeId;
            break;
          }
        }

        if (!matchingTrade || !matchingTradeId) continue;

        // Get current market price
        const currentPrice = await oandaService.getCurrentPrice(matchingTrade.symbol);
        if (!currentPrice) {
          console.warn('[TradeManager] handleSecureProfitsReply - Failed to get current price, skipping');
          await logger.log('message_ignored', `Failed to get current price for trade ${matchingTradeId}`);
          continue;
        }

        const currentBid = parseFloat(currentPrice.bid);
        const priceDiff = currentBid - matchingTrade.entryPrice;
        const pnl = priceDiff * matchingTrade.lotSize * 100;

        console.log(`[TradeManager] handleSecureProfitsReply [${strategy.name}] - Current bid: ${currentBid}, Entry: ${matchingTrade.entryPrice}, PnL: ${pnl.toFixed(2)}`);

        if (pnl > 0) {
          // Trade is in profit - close it
          console.log(`[TradeManager] handleSecureProfitsReply [${strategy.name}] - Trade is in profit, closing...`);
          await logger.log('message_received', `Reply "secure ur profits" detected. Trade ${matchingTradeId} (${strategy.name}) is in profit ($${pnl.toFixed(2)}), closing...`);
          await this.closeTradeManually(matchingTradeId);
        } else {
          // Trade is not in profit - skip closing
          console.log(`[TradeManager] handleSecureProfitsReply [${strategy.name}] - Trade NOT in profit, skipping close`);
          await logger.log('message_ignored', `Reply "secure ur profits" detected but trade ${matchingTradeId} (${strategy.name}) not in profit ($${pnl.toFixed(2)}), skipping`);
        }
      }
    } catch (error: any) {
      console.error('[TradeManager] handleSecureProfitsReply - Error:', error.message);
      await logger.log('message_ignored', `Failed to handle secure profits reply: ${error.message}`);
    }
  }

  /**
   * Get trade by ID across all strategies
   */
  private async getTradeById(tradeId: string): Promise<Trade | undefined> {
    for (const activeMap of this.activeTrades.values()) {
      const trade = activeMap.get(tradeId);
      if (trade) return trade;
    }
    // Also check storage
    const allTrades = await getTrades();
    return allTrades.find(t => t.id === tradeId);
  }

  async getActiveTrades(strategyId?: string): Promise<Trade[]> {
    if (strategyId) {
      const activeMap = this.getActiveMap(strategyId);
      return Array.from(activeMap.values());
    }

    // Return all active trades across all strategies
    const allTrades: Trade[] = [];
    for (const activeMap of this.activeTrades.values()) {
      allTrades.push(...Array.from(activeMap.values()));
    }
    return allTrades;
  }

  /**
   * Start periodic trade age checker
   */
  startPeriodicAgeChecker(): void {
    if (this.ageCheckInterval) return;

    console.log('[TradeManager] Starting periodic trade age checker (every 60s)');

    this.ageCheckInterval = setInterval(async () => {
      await this.checkTradeAges();
    }, 60000);
  }

  /**
   * Check all open trades and close those that exceed the timeout without SL/TP
   */
  private async checkTradeAges(): Promise<void> {
    try {
      const strategies = await getStrategies();
      const strategyMap = new Map<string, Strategy>();
      strategies.forEach(s => strategyMap.set(s.id, s));

      for (const [strategyId, activeMap] of this.activeTrades.entries()) {
        const strategy = strategyMap.get(strategyId);
        if (!strategy) continue;

        const timeoutMs = strategy.trading.closeTimeoutMinutes * 60 * 1000;
        const now = new Date();

        for (const [tradeId, trade] of activeMap.entries()) {
          // Skip trades that already have SL/TP set
          if (trade.sl || trade.tp) continue;

          const tradeAge = now.getTime() - new Date(trade.openTime).getTime();

          if (tradeAge > timeoutMs) {
            console.log(`[TradeManager] Trade ${trade.id} (${strategy.name}) age (${Math.round(tradeAge / 1000)}s) exceeds timeout (${strategy.trading.closeTimeoutMinutes}m), closing...`);
            await logger.log('message_received', `Trade ${trade.id} (${strategy.name}) timed out without SL/TP, closing`);
            await this.closeTradeManually(trade.id);
          }
        }
      }
    } catch (error: any) {
      console.error('[TradeManager] Error checking trade ages:', error.message);
    }
  }

  /**
   * Stop periodic trade age checker
   */
  stopPeriodicAgeChecker(): void {
    if (this.ageCheckInterval) {
      clearInterval(this.ageCheckInterval);
      this.ageCheckInterval = null;
      console.log('[TradeManager] Stopped periodic trade age checker');
    }
  }

  async cleanup(): Promise<void> {
    this.stopPeriodicAgeChecker();
    this.pendingTrades.clear();
    this.activeTrades.clear();
  }
}

export const tradeManager = new TradeManager();
