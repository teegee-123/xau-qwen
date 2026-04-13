import { addTrade, updateTrade, getOpenTrades, Trade, getTrades, saveTrades } from '../storage/json-store';
import { oandaService } from './oanda.service';
import { priceService } from './price.service';
import { logger } from './logger.service';
import { getConfig } from '../storage/json-store';

interface PendingTrade {
  messageId: string;
  initialMessage: string;
  price: number;
  timestamp: Date;
  tradeId?: string;
  channelId?: string;
}

class TradeManager {
  private pendingTrades = new Map<string, PendingTrade>();
  private activeTrades = new Map<string, Trade>();
  private ageCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Restore trade state from persistent storage after server restart
   */
  async restoreState(): Promise<void> {
    try {
      const config = await getConfig();
      const openTrades = await getTrades();

      // Filter to only OPEN trades
      const stillOpenTrades = openTrades.filter(t => t.status === 'OPEN');

      if (stillOpenTrades.length === 0) {
        await logger.log('message_received', 'No open trades to restore');
        return;
      }

      await logger.log('message_received', `Restoring ${stillOpenTrades.length} open trades from storage`);

      // Fetch open trades from OANDA to recover missing oandaTradeId values
      let oandaTrades: any[] = [];
      try {
        oandaTrades = await oandaService.getOpenTrades();
        console.log(`[TradeManager] Fetched ${oandaTrades.length} open trades from OANDA`);
      } catch (error: any) {
        console.warn('[TradeManager] Failed to fetch OANDA trades for recovery:', error.message);
      }

      const now = new Date();

      for (const trade of stillOpenTrades) {
        // Check if trade is missing oandaTradeId and try to recover it
        if (!trade.oandaTradeId && oandaTrades.length > 0) {
          console.log(`[TradeManager] Trade ${trade.id} missing oandaTradeId, attempting recovery...`);

          // Try to match by instrument and approximate entry time/price
          const matchingOandaTrade = oandaTrades.find(oandaTrade => {
            const sameInstrument = oandaTrade.instrument === trade.symbol;
            const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5; // Within $5
            const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000; // Within 2 minutes

            return sameInstrument && (similarPrice || similarTime);
          });

          if (matchingOandaTrade) {
            console.log(`[TradeManager] Recovered oandaTradeId: ${matchingOandaTrade.id} for trade ${trade.id}`);
            trade.oandaTradeId = matchingOandaTrade.id;

            // Update the trade in storage with the recovered oandaTradeId
            await updateTrade(trade.id, { oandaTradeId: matchingOandaTrade.id });
            await logger.log('message_received', `Recovered OANDA trade ID ${matchingOandaTrade.id} for trade ${trade.id}`);
          } else {
            console.warn(`[TradeManager] Could not recover oandaTradeId for trade ${trade.id}`);
          }
        }

        // Add to active trades map
        this.activeTrades.set(trade.id, trade);
      }

      await logger.log('message_received', `Trade state restoration complete: ${this.activeTrades.size} active`);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to restore trade state: ${error.message}`);
    }
  }

  async handleInitialSignal(messageId: string, message: string, price: number, channelId?: string): Promise<void> {
    const config = await getConfig();

    // Create pending trade
    const pending: PendingTrade = {
      messageId,
      initialMessage: message,
      price,
      timestamp: new Date()
    };

    this.pendingTrades.set(messageId, pending);

    // Place market buy order immediately
    try {
      const tradeResult = await oandaService.placeMarketOrder({
        instrument: config.trading.symbol,
        units: config.trading.lotSize * 1000, // OANDA uses units (1000 units = 0.01 lot for most pairs)
        timeInForce: 'FOK',
        positionFill: 'DEFAULT'
      });

      console.log('[TradeManager] OANDA trade result:', {
        tradeId: tradeResult.tradeId,
        tradeIdType: typeof tradeResult.tradeId,
        price: tradeResult.price,
        instrument: tradeResult.instrument
      });

      // Check if trailing SL is enabled
      const trailingDistance = config.trading.trailingStopDistance || 0;
      const useTrailingSL = trailingDistance > 0;

      // Create trade record
      const tradeData: any = {
        type: 'BUY' as const,
        symbol: config.trading.symbol,
        entryPrice: parseFloat(tradeResult.price),
        lotSize: config.trading.lotSize,
        openTime: new Date().toISOString(),
        status: 'OPEN' as const,
        matchedMessage: {
          initial: message
        },
        retries: 0,
        channelId,
        telegramMessageId: messageId,
        oandaTradeId: tradeResult.tradeId,
        trailingStopDistance: trailingDistance // Store for price service to use
      };

      // If trailing SL is enabled, set initial SL and no TP
      if (useTrailingSL) {
        const initialSL = tradeData.entryPrice - trailingDistance;
        tradeData.sl = initialSL;
        tradeData.tp = undefined; // No TP when trailing
        console.log(`[TradeManager] Trailing SL enabled: Initial SL=${initialSL}, Distance=${trailingDistance}`);
      }

      console.log('[TradeManager] Trade data to save:', {
        hasOandaTradeId: !!tradeData.oandaTradeId,
        oandaTradeId: tradeData.oandaTradeId,
        oandaTradeIdType: typeof tradeData.oandaTradeId
      });

      const trade = await addTrade(tradeData);

      console.log('[TradeManager] Trade saved to storage:', {
        id: trade.id,
        hasOandaTradeId: !!trade.oandaTradeId,
        oandaTradeId: trade.oandaTradeId
      });

      pending.tradeId = trade.id;
      this.activeTrades.set(trade.id, trade);

      await logger.tradeOpened(trade);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to place trade: ${error.message}`);
      this.pendingTrades.delete(messageId);
    }
  }

  async handleEditedSignal(messageId: string, message: string, sl: number, tp: number): Promise<void> {
    console.log('[TradeManager] handleEditedSignal - MessageId:', messageId, 'SL:', sl, 'TP:', tp);
    
    const pending = this.pendingTrades.get(messageId);
    console.log('[TradeManager] handleEditedSignal - Pending trade found:', pending ? 'YES' : 'NO');

    if (!pending || !pending.tradeId) {
      console.log('[TradeManager] handleEditedSignal - No pending trade found, ignoring');
      await logger.log('message_ignored', 'No pending trade found for edited message');
      return;
    }

    const trade = this.activeTrades.get(pending.tradeId);
    console.log('[TradeManager] handleEditedSignal - Active trade found:', trade ? 'YES' : 'NO');

    if (!trade) {
      console.log('[TradeManager] handleEditedSignal - Trade not found in active trades');
      await logger.log('message_ignored', 'Trade not found in active trades');
      return;
    }

    try {
      // Check if trailing SL is enabled in config
      const config = await getConfig();
      const trailingDistance = config.trading.trailingStopDistance || 0;

      if (trailingDistance > 0) {
        // Trailing SL is active - ignore SL/TP from edited message
        console.log(`[TradeManager] handleEditedSignal - Trailing SL active (distance=${trailingDistance}), ignoring message SL/TP`);
        await logger.log('message_received', `Edited message received but trailing SL is active. Ignoring SL=${sl}, TP=${tp}`);
        
        // Just update the trade record to note the edited message was received
        const updatedTrade = await updateTrade(pending.tradeId, {
          matchedMessage: {
            ...trade.matchedMessage,
            edited: message
          }
        });

        if (updatedTrade) {
          this.activeTrades.set(pending.tradeId, updatedTrade);
        }

        console.log('[TradeManager] handleEditedSignal - Trailing SL will manage SL automatically');
        await logger.tradeUpdated(updatedTrade || trade);
        return;
      }

      // Trailing SL not active - proceed with normal SL/TP update
      // Always fetch from OANDA first - OANDA is the source of truth
      console.log('[TradeManager] handleEditedSignal - Fetching open trades from OANDA...');
      const oandaTrades = await oandaService.getOpenTrades();
      console.log(`[TradeManager] Found ${oandaTrades.length} open trades on OANDA`);

      // Find matching trade on OANDA by instrument and entry price
      const matchingOandaTrade = oandaTrades.find(oandaTrade => {
        const sameInstrument = oandaTrade.instrument === trade.symbol;
        const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
        const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
        return sameInstrument && (similarPrice || similarTime);
      });

      if (!matchingOandaTrade) {
        console.warn(`[TradeManager] Trade ${trade.id} not found on OANDA - may already be closed`);
        await logger.log('message_ignored', `Cannot update SL/TP: Trade ${trade.id} not found on OANDA`);
        return;
      }

      // Use OANDA's actual trade ID
      const oandaTradeId = matchingOandaTrade.id;
      console.log(`[TradeManager] handleEditedSignal - Found OANDA trade: ${oandaTradeId} for internal trade: ${trade.id}`);

      // Update local record with correct OANDA trade ID
      await updateTrade(trade.id, { oandaTradeId });
      trade.oandaTradeId = oandaTradeId;

      console.log('[TradeManager] handleEditedSignal - Calling OANDA updateSLTP, TradeId:', oandaTradeId);

      await oandaService.updateSLTP(oandaTradeId, String(sl), String(tp));

      // Update trade record with SL/TP
      const updatedTrade = await updateTrade(pending.tradeId, {
        sl,
        tp,
        pendingEdit: undefined, // Clear pending edit
        matchedMessage: {
          ...trade.matchedMessage,
          edited: message
        }
      });

      if (updatedTrade) {
        this.activeTrades.set(pending.tradeId, updatedTrade);
      }

      console.log('[TradeManager] handleEditedSignal - SL/TP updated successfully');
      await logger.tradeUpdated(updatedTrade || trade);
    } catch (error: any) {
      console.error('[TradeManager] handleEditedSignal - Error:', error.message);
      await logger.log('message_ignored', `Failed to update SL/TP: ${error.message}`);
    }
  }

  private async handleTimeout(tradeId: string, messageId: string): Promise<void> {
    const trade = this.activeTrades.get(tradeId);

    if (!trade) {
      return;
    }

    try {
      // Always fetch from OANDA first - OANDA is the source of truth
      console.log(`[TradeManager] Fetching open trades from OANDA to find trade ${tradeId}...`);
      const oandaTrades = await oandaService.getOpenTrades();
      console.log(`[TradeManager] Found ${oandaTrades.length} open trades on OANDA`);

      // Find matching trade on OANDA by instrument and entry price
      const matchingOandaTrade = oandaTrades.find(oandaTrade => {
        const sameInstrument = oandaTrade.instrument === trade.symbol;
        const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
        const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
        return sameInstrument && (similarPrice || similarTime);
      });

      if (!matchingOandaTrade) {
        // Trade not found on OANDA open trades - likely already closed by TP/SL server-side
        console.warn(`[TradeManager] handleTimeout - Trade ${tradeId} not found on OANDA open trades`);
        await logger.log('message_ignored', `Trade ${tradeId} not found on OANDA, calculating PnL from current price`);

        // Try to calculate PnL using current market price
        try {
          const currentPrice = await oandaService.getCurrentPrice(trade.symbol);
          let closePrice = trade.entryPrice;
          let pnl = 0;

          if (currentPrice) {
            closePrice = parseFloat(currentPrice.bid);
            const priceDiff = closePrice - trade.entryPrice;
            pnl = priceDiff * trade.lotSize * 100;
            console.log(`[TradeManager] handleTimeout - Trade already closed, calculated PnL: ${pnl.toFixed(2)}`);
          }

          // Capture peak price even for already-closed trades
          const peakPrice = priceService.getTradePeakPrice(tradeId);

          const updatedTrade = await updateTrade(tradeId, {
            status: 'CLOSED',
            closeTime: new Date().toISOString(),
            closePrice,
            pnl,
            pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
            peakPrice: peakPrice || undefined
          });

          if (updatedTrade) {
            this.activeTrades.delete(tradeId);
          }

          // Clean up peak price tracking
          priceService.removeTradePeakPrice(tradeId);

          this.pendingTrades.delete(messageId);
          await logger.tradeClosed(updatedTrade || trade);
          return;
        } catch (priceError: any) {
          console.error(`[TradeManager] handleTimeout - Failed to fetch current price:`, priceError.message);
        }

        // Fallback - still capture peak price
        const peakPrice = priceService.getTradePeakPrice(tradeId);

        const updatedTrade = await updateTrade(tradeId, {
          status: 'CLOSED',
          closeTime: new Date().toISOString(),
          closePrice: trade.entryPrice,
          pnl: 0,
          pnlPercent: 0,
          peakPrice: peakPrice || undefined
        });

        if (updatedTrade) {
          this.activeTrades.delete(tradeId);
        }

        // Clean up peak price tracking
        priceService.removeTradePeakPrice(tradeId);

        this.pendingTrades.delete(messageId);
        await logger.tradeClosed(updatedTrade || trade);
        return;
      }

      // Update local record with correct OANDA trade ID
      const oandaTradeId = matchingOandaTrade.id;
      console.log(`[TradeManager] Found matching OANDA trade: ${oandaTradeId} for trade ${tradeId}`);
      await updateTrade(tradeId, { oandaTradeId });
      trade.oandaTradeId = oandaTradeId;

      // Close position using OANDA trade ID
      console.log(`[TradeManager] Closing trade via OANDA: ${oandaTradeId}`);
      const result = await oandaService.closePosition(oandaTradeId);

      // If OANDA didn't return PnL, calculate it manually
      let pnl = parseFloat(result.pnl);
      const closePrice = parseFloat(result.closePrice);

      if (pnl === 0 && closePrice > 0) {
        const priceDiff = closePrice - trade.entryPrice;
        pnl = priceDiff * trade.lotSize * 100;
        console.log(`[TradeManager] handleTimeout - OANDA returned PnL=0, calculated manually: ${pnl}`);
      }

      // Capture peak price before cleanup
      const peakPrice = priceService.getTradePeakPrice(tradeId);

      // Update trade record
      const updatedTrade = await updateTrade(tradeId, {
        status: 'CLOSED',
        closeTime: new Date().toISOString(),
        closePrice: closePrice,
        pnl: pnl,
        pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
        peakPrice: peakPrice || undefined
      });

      if (updatedTrade) {
        this.activeTrades.delete(tradeId);
      }

      // Clean up peak price tracking
      priceService.removeTradePeakPrice(tradeId);

      this.pendingTrades.delete(messageId);

      await logger.tradeClosed(updatedTrade || trade);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to close timed out trade: ${error.message}`);
      console.error(`[TradeManager] Error closing trade ${tradeId}:`, error.message);
    }
  }

  async closeTradeManually(tradeId: string): Promise<void> {
    const trade = this.activeTrades.get(tradeId);

    if (!trade) {
      throw new Error('Trade not found');
    }

    try {
      // Always fetch from OANDA first - OANDA is the source of truth
      console.log(`[TradeManager] Fetching open trades from OANDA to find trade ${tradeId}...`);
      const oandaTrades = await oandaService.getOpenTrades();
      console.log(`[TradeManager] Found ${oandaTrades.length} open trades on OANDA`);

      // Find matching trade on OANDA by instrument and entry price
      const matchingOandaTrade = oandaTrades.find(oandaTrade => {
        const sameInstrument = oandaTrade.instrument === trade.symbol;
        const similarPrice = Math.abs(parseFloat(oandaTrade.price) - trade.entryPrice) < 5;
        const similarTime = Math.abs(new Date(oandaTrade.createTime).getTime() - new Date(trade.openTime).getTime()) < 120000;
        return sameInstrument && (similarPrice || similarTime);
      });

      if (!matchingOandaTrade) {
        // Trade not found on OANDA open trades - likely already closed by TP/SL server-side
        console.warn(`[TradeManager] Trade ${tradeId} not found on OANDA open trades - may already be closed by TP/SL`);
        await logger.log('message_ignored', `Trade ${tradeId} not found on OANDA, calculating PnL from current price`);

        // Try to calculate PnL using current market price
        try {
          const currentPrice = await oandaService.getCurrentPrice(trade.symbol);
          let closePrice = trade.entryPrice;
          let pnl = 0;

          if (currentPrice) {
            // For BUY trades, use bid price
            closePrice = parseFloat(currentPrice.bid);
            const priceDiff = closePrice - trade.entryPrice;
            pnl = priceDiff * trade.lotSize * 100;
            console.log(`[TradeManager] Trade already closed on OANDA, calculated PnL: ${pnl.toFixed(2)} (close: ${closePrice}, entry: ${trade.entryPrice})`);
          } else {
            console.warn(`[TradeManager] Could not fetch current price for ${trade.symbol}, using entry price`);
          }

          // Capture peak price even for already-closed trades
          const peakPrice = priceService.getTradePeakPrice(tradeId);

          const updatedTrade = await updateTrade(tradeId, {
            status: 'CLOSED',
            closeTime: new Date().toISOString(),
            closePrice,
            pnl,
            pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
            peakPrice: peakPrice || undefined
          });

          if (updatedTrade) {
            this.activeTrades.delete(tradeId);
          }

          // Clean up peak price tracking
          priceService.removeTradePeakPrice(tradeId);

          await logger.tradeClosed(updatedTrade || trade);
          return;
        } catch (priceError: any) {
          console.error(`[TradeManager] Failed to fetch current price for PnL calculation:`, priceError.message);
          // Fall through to default PnL=0
        }

        // Fallback - still capture peak price
        const peakPrice = priceService.getTradePeakPrice(tradeId);

        const updatedTrade = await updateTrade(tradeId, {
          status: 'CLOSED',
          closeTime: new Date().toISOString(),
          closePrice: trade.entryPrice,
          pnl: 0,
          pnlPercent: 0,
          peakPrice: peakPrice || undefined
        });

        if (updatedTrade) {
          this.activeTrades.delete(tradeId);
        }

        // Clean up peak price tracking
        priceService.removeTradePeakPrice(tradeId);

        await logger.tradeClosed(updatedTrade || trade);
        return;
      }

      // Update local record with correct OANDA trade ID
      const oandaTradeId = matchingOandaTrade.id;
      console.log(`[TradeManager] Found matching OANDA trade: ${oandaTradeId} for trade ${tradeId}`);
      await updateTrade(tradeId, { oandaTradeId });
      trade.oandaTradeId = oandaTradeId;

      // Close position using OANDA trade ID
      console.log(`[TradeManager] Closing trade via OANDA: ${oandaTradeId}`);
      const result = await oandaService.closePosition(oandaTradeId);

      // If OANDA didn't return PnL, calculate it manually
      let pnl = parseFloat(result.pnl);
      const closePrice = parseFloat(result.closePrice);

      if (pnl === 0 && closePrice > 0) {
        // Calculate PnL manually: (closePrice - entryPrice) * lotSize * 100
        const priceDiff = closePrice - trade.entryPrice;
        pnl = priceDiff * trade.lotSize * 100;
        console.log(`[TradeManager] OANDA returned PnL=0, calculated manually: ${pnl}`);
      }

      // Capture peak price before cleanup
      const peakPrice = priceService.getTradePeakPrice(tradeId);

      const updatedTrade = await updateTrade(tradeId, {
        status: 'CLOSED',
        closeTime: new Date().toISOString(),
        closePrice: closePrice,
        pnl: pnl,
        pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0,
        peakPrice: peakPrice || undefined
      });

      if (updatedTrade) {
        this.activeTrades.delete(tradeId);
      }

      // Clean up peak price tracking
      priceService.removeTradePeakPrice(tradeId);

      await logger.tradeClosed(updatedTrade || trade);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to close trade: ${error.message}`);
      console.error(`[TradeManager] Error closing trade ${tradeId}:`, error.message);
      throw error;
    }
  }

  /**
   * Handle "secure ur Profits" reply message
   * Finds the open trade by the original signal message ID, checks if in profit, and closes if yes
   */
  async handleSecureProfitsReply(signalMessageId: string): Promise<void> {
    try {
      const config = await getConfig();

      // Check if feature is enabled
      if (!config.trading.listenToReplies) {
        console.log('[TradeManager] handleSecureProfitsReply - listenToReplies is OFF, ignoring');
        return;
      }

      console.log('[TradeManager] handleSecureProfitsReply - Looking for open trade with telegramMessageId:', signalMessageId);

      // Find open trade by telegram message ID
      const openTrades = await getOpenTrades();
      const matchingTrade = openTrades.find(t => t.telegramMessageId === signalMessageId);

      if (!matchingTrade) {
        console.log('[TradeManager] handleSecureProfitsReply - No open trade found for telegramMessageId:', signalMessageId);
        await logger.log('message_ignored', `No open trade found for signal message ${signalMessageId}`);
        return;
      }

      console.log('[TradeManager] handleSecureProfitsReply - Found trade:', matchingTrade.id, 'Entry:', matchingTrade.entryPrice);

      // Get current market price
      const currentPrice = await oandaService.getCurrentPrice(matchingTrade.symbol);
      if (!currentPrice) {
        console.warn('[TradeManager] handleSecureProfitsReply - Failed to get current price, skipping');
        await logger.log('message_ignored', `Failed to get current price for trade ${matchingTrade.id}`);
        return;
      }

      // For BUY trades, use bid price to calculate profit
      const currentBid = parseFloat(currentPrice.bid);
      const priceDiff = currentBid - matchingTrade.entryPrice;
      const pnl = priceDiff * matchingTrade.lotSize * 100;

      console.log('[TradeManager] handleSecureProfitsReply - Current bid:', currentBid, 'Entry:', matchingTrade.entryPrice, 'PnL:', pnl.toFixed(2));

      if (pnl > 0) {
        // Trade is in profit - close it
        console.log('[TradeManager] handleSecureProfitsReply - Trade is in profit, closing...');
        await logger.log('message_received', `Reply "secure ur profits" detected. Trade ${matchingTrade.id} is in profit ($${pnl.toFixed(2)}), closing...`);
        await this.closeTradeManually(matchingTrade.id);
      } else {
        // Trade is not in profit - skip closing
        console.log('[TradeManager] handleSecureProfitsReply - Trade is NOT in profit, skipping close');
        await logger.log('message_ignored', `Reply "secure ur profits" detected but trade ${matchingTrade.id} not in profit ($${pnl.toFixed(2)}), skipping`);
      }
    } catch (error: any) {
      console.error('[TradeManager] handleSecureProfitsReply - Error:', error.message);
      await logger.log('message_ignored', `Failed to handle secure profits reply: ${error.message}`);
    }
  }

  async getActiveTrades(): Promise<Trade[]> {
    return await getOpenTrades();
  }

  /**
   * Start periodic trade age checker
   * Closes trades that are older than closeTimeoutMinutes and have no SL/TP set
   */
  startPeriodicAgeChecker(): void {
    if (this.ageCheckInterval) return; // Already running

    console.log('[TradeManager] Starting periodic trade age checker (every 60s)');
    
    this.ageCheckInterval = setInterval(async () => {
      await this.checkTradeAges();
    }, 60000); // Check every 60 seconds
  }

  /**
   * Check all open trades and close those that exceed the timeout without SL/TP
   */
  private async checkTradeAges(): Promise<void> {
    try {
      const config = await getConfig();
      const timeoutMs = config.trading.closeTimeoutMinutes * 60 * 1000;
      const openTrades = await getOpenTrades();
      const now = new Date();

      for (const trade of openTrades) {
        // Skip trades that already have SL/TP set
        if (trade.sl || trade.tp) continue;

        const tradeAge = now.getTime() - new Date(trade.openTime).getTime();
        
        if (tradeAge > timeoutMs) {
          console.log(`[TradeManager] Trade ${trade.id} age (${Math.round(tradeAge / 1000)}s) exceeds timeout (${config.trading.closeTimeoutMinutes}m), closing...`);
          await logger.log('message_received', `Trade ${trade.id} timed out without SL/TP, closing`);
          await this.closeTradeManually(trade.id);
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
    // Stop periodic age checker
    this.stopPeriodicAgeChecker();
    this.pendingTrades.clear();
    this.activeTrades.clear();
  }
}

export const tradeManager = new TradeManager();
