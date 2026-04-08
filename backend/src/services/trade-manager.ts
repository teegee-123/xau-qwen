import { addTrade, updateTrade, getOpenTrades, Trade, getTrades, saveTrades } from '../storage/json-store';
import { oandaService } from './oanda.service';
import { logger } from './logger.service';
import { getConfig } from '../storage/json-store';

interface PendingTrade {
  messageId: string;
  initialMessage: string;
  price: number;
  timestamp: Date;
  tradeId?: string;
  timeoutTimer?: NodeJS.Timeout;
  channelId?: string;
}

class TradeManager {
  private pendingTrades = new Map<string, PendingTrade>();
  private activeTrades = new Map<string, Trade>();

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

        // Check if trade has a pending edit
        if (trade.pendingEdit && trade.telegramMessageId) {
          const pending: PendingTrade = {
            messageId: trade.telegramMessageId,
            initialMessage: trade.matchedMessage.initial,
            price: trade.entryPrice,
            timestamp: new Date(trade.openTime),
            tradeId: trade.id,
            channelId: trade.channelId
          };

          this.pendingTrades.set(trade.telegramMessageId, pending);
          await logger.log('message_received', `Restored pending edit for trade ${trade.id}`);
        }

        // Check if timeout has expired
        if (trade.timeoutUntil) {
          const timeoutTime = new Date(trade.timeoutUntil);
          if (timeoutTime <= now) {
            // Timeout already expired, close the trade
            await logger.log('message_received', `Trade ${trade.id} timeout expired during downtime, closing`);
            try {
              await this.closeTradeManually(trade.id);
            } catch (error: any) {
              await logger.log('message_ignored', `Failed to close expired trade ${trade.id}: ${error.message}`);
            }
          } else {
            // Timeout still active, set remaining time
            const remainingMs = timeoutTime.getTime() - now.getTime();
            const timeoutTimer = setTimeout(() => {
              this.handleTimeout(trade.id, trade.telegramMessageId || '');
            }, remainingMs);

            await logger.log('message_received', `Trade ${trade.id} timeout restored (${Math.round(remainingMs / 1000)}s remaining)`);
          }
        }
      }

      await logger.log('message_received', `Trade state restoration complete: ${this.activeTrades.size} active, ${this.pendingTrades.size} pending`);
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

      // Create trade record with persistence fields
      const timeoutMs = config.trading.closeTimeoutMinutes * 60 * 1000;
      const timeoutUntil = new Date(Date.now() + timeoutMs);

      const tradeData = {
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
        timeoutUntil: timeoutUntil.toISOString(),
        oandaTradeId: tradeResult.tradeId // Store OANDA trade ID
      };

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

      // Set timeout timer (default 3 minutes)
      pending.timeoutTimer = setTimeout(() => {
        this.handleTimeout(trade.id, messageId);
      }, timeoutMs);

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

      // Update trade record and clear timeout
      const updatedTrade = await updateTrade(pending.tradeId, {
        sl,
        tp,
        timeoutUntil: undefined, // Clear timeout since SL/TP are set
        pendingEdit: undefined, // Clear pending edit
        matchedMessage: {
          ...trade.matchedMessage,
          edited: message
        }
      });

      if (updatedTrade) {
        this.activeTrades.set(pending.tradeId, updatedTrade);
      }

      // Clear timeout timer
      if (pending.timeoutTimer) {
        clearTimeout(pending.timeoutTimer);
        pending.timeoutTimer = undefined;
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

          const updatedTrade = await updateTrade(tradeId, {
            status: 'CLOSED',
            closeTime: new Date().toISOString(),
            closePrice,
            pnl,
            pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0
          });

          if (updatedTrade) {
            this.activeTrades.delete(tradeId);
          }

          this.pendingTrades.delete(messageId);
          await logger.tradeClosed(updatedTrade || trade);
          return;
        } catch (priceError: any) {
          console.error(`[TradeManager] handleTimeout - Failed to fetch current price:`, priceError.message);
        }

        // Fallback
        const updatedTrade = await updateTrade(tradeId, {
          status: 'CLOSED',
          closeTime: new Date().toISOString(),
          closePrice: trade.entryPrice,
          pnl: 0,
          pnlPercent: 0
        });

        if (updatedTrade) {
          this.activeTrades.delete(tradeId);
        }

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

      // Update trade record
      const updatedTrade = await updateTrade(tradeId, {
        status: 'CLOSED',
        closeTime: new Date().toISOString(),
        closePrice: closePrice,
        pnl: pnl,
        pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0
      });

      if (updatedTrade) {
        this.activeTrades.delete(tradeId);
      }

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

          const updatedTrade = await updateTrade(tradeId, {
            status: 'CLOSED',
            closeTime: new Date().toISOString(),
            closePrice,
            pnl,
            pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0
          });

          if (updatedTrade) {
            this.activeTrades.delete(tradeId);
          }

          await logger.tradeClosed(updatedTrade || trade);
          return;
        } catch (priceError: any) {
          console.error(`[TradeManager] Failed to fetch current price for PnL calculation:`, priceError.message);
          // Fall through to default PnL=0
        }

        // Fallback: Mark as CLOSED with PnL=0
        const updatedTrade = await updateTrade(tradeId, {
          status: 'CLOSED',
          closeTime: new Date().toISOString(),
          closePrice: trade.entryPrice,
          pnl: 0,
          pnlPercent: 0
        });

        if (updatedTrade) {
          this.activeTrades.delete(tradeId);
        }

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

      const updatedTrade = await updateTrade(tradeId, {
        status: 'CLOSED',
        closeTime: new Date().toISOString(),
        closePrice: closePrice,
        pnl: pnl,
        pnlPercent: trade.entryPrice > 0 ? (pnl / (trade.entryPrice * trade.lotSize)) * 100 : 0
      });

      if (updatedTrade) {
        this.activeTrades.delete(tradeId);
      }

      await logger.tradeClosed(updatedTrade || trade);
    } catch (error: any) {
      await logger.log('message_ignored', `Failed to close trade: ${error.message}`);
      console.error(`[TradeManager] Error closing trade ${tradeId}:`, error.message);
      throw error;
    }
  }

  async getActiveTrades(): Promise<Trade[]> {
    return await getOpenTrades();
  }

  async cleanup(): Promise<void> {
    // Clear all timeout timers
    for (const [id, pending] of this.pendingTrades.entries()) {
      if (pending.timeoutTimer) {
        clearTimeout(pending.timeoutTimer);
      }
    }
    this.pendingTrades.clear();
    this.activeTrades.clear();
  }
}

export const tradeManager = new TradeManager();
