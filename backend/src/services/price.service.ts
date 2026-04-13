import { oandaService } from './oanda.service';
import { logger } from './logger.service';
import { getConfig, getOpenTrades, updateTrade } from '../storage/json-store';
import { tradeManager } from './trade-manager';

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
}

interface TrailingState {
  tradeId: string;
  peakPrice: number;
  currentSL: number;
  distance: number;
}

class PriceService {
  private currentPrice: PriceData | null = null;
  private socketIO: any = null;
  private isRunning = false;
  private isStreaming = false;
  private streamAbortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 10000; // 10 seconds max between heartbeats
  private recentlyCheckedTrades = new Set<string>(); // Track trades already checked for SL/TP
  private trailingStates = new Map<string, TrailingState>(); // Track trailing SL state per trade
  private tradePeakPrices = new Map<string, number>(); // Track ATH (peak bid) for ALL open trades, independent of trailing stop

  // Polling fallback
  private priceInterval: NodeJS.Timeout | null = null;
  private pollIntervalMs = 5000; // 5 seconds

  /**
   * Set Socket.IO instance for broadcasting
   */
  setSocketIO(io: any): void {
    this.socketIO = io;
  }

  /**
   * Start price service - tries streaming first, falls back to polling
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[PriceService] Already running');
      return;
    }

    try {
      const config = await getConfig();
      let symbol = config.trading?.symbol || 'XAU_USD';

      // Auto-migrate common incorrect symbol formats
      if (symbol === 'XAUUSD') {
        console.log('[PriceService] Auto-correcting trading symbol from XAUUSD to XAU_USD for OANDA API compatibility');
        symbol = 'XAU_USD';
        // Update config with corrected symbol
        config.trading!.symbol = 'XAU_USD';
        await require('../storage/json-store').updateConfig({ trading: config.trading });
      }

      console.log(`[PriceService] Starting price service for ${symbol}`);

      // Try streaming first
      const streamStarted = await this.startStreaming(symbol);
      
      if (!streamStarted) {
        console.warn('[PriceService] Streaming failed, falling back to polling');
        this.startPolling(symbol);
      }

      this.isRunning = true;
      await logger.log('message_received', `Price service started for ${symbol} (${this.isStreaming ? 'streaming' : 'polling'})`);
    } catch (error: any) {
      console.error('[PriceService] Failed to start:', error.message);
      await logger.log('message_ignored', `Price service start failed: ${error.message}`);
    }
  }

  /**
   * Start streaming price updates from OANDA
   */
  private async startStreaming(symbol: string): Promise<boolean> {
    try {
      // Check if OANDA service is connected
      if (!oandaService.getStatus()) {
        console.log('[PriceService] OANDA not connected, skipping streaming');
        return false;
      }

      const streamUrl = oandaService.getStreamingUrl();
      const accountId = oandaService.getAccountId();
      const token = oandaService.getToken();

      if (!streamUrl || !accountId || !token) {
        console.warn('[PriceService] Missing streaming configuration');
        return false;
      }

      const streamEndpoint = `${streamUrl}/v3/accounts/${accountId}/pricing/stream?instruments=${symbol}`;
      console.log(`[PriceService] Connecting to streaming price endpoint: ${streamEndpoint}`);

      // Create abort controller for this stream
      this.streamAbortController = new AbortController();

      // Start streaming in background
      this.streamPrices(streamEndpoint, symbol, token).catch(error => {
        console.error('[PriceService] Stream error:', error.message);
        this.isStreaming = false;
        
        // Try to reconnect if still running
        if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect(symbol);
        } else if (this.isRunning) {
          console.warn('[PriceService] Max reconnect attempts reached, falling back to polling');
          this.startPolling(symbol);
        }
      });

      this.isStreaming = true;
      this.reconnectAttempts = 0;
      console.log('[PriceService] ✅ Streaming price updates started');
      return true;
    } catch (error: any) {
      console.error('[PriceService] Failed to start streaming:', error.message);
      this.isStreaming = false;
      return false;
    }
  }

  /**
   * Stream prices from OANDA NDJSON endpoint
   */
  private async streamPrices(endpoint: string, symbol: string, token: string): Promise<void> {
    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      signal: this.streamAbortController?.signal
    });

    if (!response.ok) {
      throw new Error(`Stream connection failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Stream response body is null');
    }

    console.log('[PriceService] Stream connected, reading NDJSON...');
    this.resetHeartbeatTimeout();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('[PriceService] Stream ended');
          break;
        }

        // Decode chunk and parse NDJSON lines
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            this.handleStreamMessage(data, symbol);
          } catch (parseError) {
            console.warn('[PriceService] Failed to parse stream line:', line);
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[PriceService] Stream aborted');
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle incoming stream message (price update or heartbeat)
   */
  private async handleStreamMessage(data: any, symbol: string): Promise<void> {
    // Check for heartbeat
    if (data.type === 'HEARTBEAT') {
      this.resetHeartbeatTimeout();
      return;
    }

    // Check for price data
    if (data.instrument && data.bids && data.asks) {
      if (data.instrument !== symbol) {
        return; // Ignore other instruments
      }

      const bid = parseFloat(data.bids[0]?.price);
      const ask = parseFloat(data.asks[0]?.price);

      if (isNaN(bid) || isNaN(ask)) {
        return; // Invalid price data
      }

      const previousPrice = this.currentPrice;

      this.currentPrice = {
        symbol,
        bid,
        ask,
        spread: ask - bid,
        timestamp: data.time || new Date().toISOString()
      };

      // Log price change (only 1% of the time to avoid terminal spam)
      if (previousPrice) {
        if (Math.random() < 0.01) {
          const bidChange = bid - previousPrice.bid;
          const direction = bidChange >= 0 ? '↑' : '↓';
          console.log(`[PriceService] ${symbol}: ${bid} ${direction} (${bidChange >= 0 ? '+' : ''}${bidChange.toFixed(2)})`);
        }
      } else {
        console.log(`[PriceService] ${symbol}: ${bid} (initial stream)`);
      }

      // Broadcast via Socket.IO
      if (this.socketIO) {
        this.socketIO.emit('price_update', this.currentPrice);
      }

      // Update peak prices for all open trades (ATH tracking, independent of trailing stop)
      await this.updateAllTradePeaks();

      // Check for SL/TP violations
      await this.checkSLTPViolation();

      // Check for trailing SL updates
      await this.checkTrailingSL();
    }
  }

  /**
   * Get the peak price (All Time High) for a specific trade.
   * This works for ALL trades, regardless of whether trailing stop is enabled.
   */
  getTradePeakPrice(tradeId: string): number | null {
    return this.tradePeakPrices.get(tradeId) ?? null;
  }

  /**
   * Remove peak price tracking for a trade (called when trade is closed)
   */
  removeTradePeakPrice(tradeId: string): void {
    this.tradePeakPrices.delete(tradeId);
    this.trailingStates.delete(tradeId);
  }

  /**
   * Update peak price tracking for all open trades.
   * This runs on every price tick and tracks the highest bid price seen for each trade.
   * Works independently of trailing stop - ALL open trades get ATH tracking.
   */
  private async updateAllTradePeaks(): Promise<void> {
    if (!this.currentPrice) return;

    try {
      const openTrades = await getOpenTrades();
      const currentBid = this.currentPrice.bid;

      for (const trade of openTrades) {
        const existingPeak = this.tradePeakPrices.get(trade.id);
        const newPeak = existingPeak !== undefined ? Math.max(existingPeak, currentBid) : Math.max(trade.entryPrice, currentBid);

        if (newPeak !== existingPeak) {
          this.tradePeakPrices.set(trade.id, newPeak);
        }
      }
    } catch (error: any) {
      console.error('[PriceService] Error updating trade peaks:', error.message);
    }
  }

  /**
   * Check and update trailing SL for all open trades
   */
  private async checkTrailingSL(): Promise<void> {
    if (!this.currentPrice) return;

    try {
      const openTrades = await getOpenTrades();
      const trailingTrades = openTrades.filter(t => t.trailingStopDistance && t.trailingStopDistance > 0 && t.symbol === this.currentPrice?.symbol);

      for (const trade of trailingTrades) {
        const distance = trade.trailingStopDistance;
        if (!distance || distance <= 0) continue; // TypeScript guard
        
        const currentBid = this.currentPrice!.bid;

        // Get or create trailing state for this trade
        let state = this.trailingStates.get(trade.id);
        if (!state) {
          state = {
            tradeId: trade.id,
            peakPrice: Math.max(trade.entryPrice, currentBid),
            currentSL: trade.sl || (trade.entryPrice - distance),
            distance: distance
          };
          this.trailingStates.set(trade.id, state);
        }

        // Ensure state is defined before using it
        if (!state) continue;

        // Update peak price if current bid is higher
        if (currentBid > state.peakPrice) {
          state.peakPrice = currentBid;
        }

        // Calculate new SL based on peak
        const newSL = state.peakPrice - state.distance;

        // Only update if new SL is higher than current SL (trailing only moves up)
        if (newSL > state.currentSL) {
          console.log(`[PriceService] Trailing SL update for trade ${trade.id}: ${state.currentSL.toFixed(2)} -> ${newSL.toFixed(2)} (peak: ${state.peakPrice.toFixed(2)})`);
          await logger.log('message_received', `Trailing SL updated for trade ${trade.id}: ${state.currentSL.toFixed(2)} -> ${newSL.toFixed(2)}`);

          // Update on OANDA
          try {
            const oandaTradeId = trade.oandaTradeId;
            if (oandaTradeId) {
              await oandaService.updateSLTP(oandaTradeId, String(newSL), undefined);
            }
          } catch (oandaError: any) {
            console.error(`[PriceService] Failed to update trailing SL on OANDA:`, oandaError.message);
          }

          // Update local state and storage
          state.currentSL = newSL;
          await updateTrade(trade.id, { sl: newSL });
        }
      }
    } catch (error: any) {
      console.error('[PriceService] Error checking trailing SL:', error.message);
    }
  }

  /**
   * Check if any open trades have violated their SL/TP levels
   */
  private async checkSLTPViolation(): Promise<void> {
    if (!this.currentPrice) return;

    try {
      const openTrades = await getOpenTrades();
      const tradesWithSLTP = openTrades.filter(t => (t.sl || t.tp) && t.symbol === this.currentPrice?.symbol);

      for (const trade of tradesWithSLTP) {
        // Skip if already checked recently (prevent duplicate closes)
        if (this.recentlyCheckedTrades.has(trade.id)) continue;

        const currentBid = this.currentPrice!.bid;
        const currentAsk = this.currentPrice!.ask;

        // For BUY trades: SL violated when bid <= SL, TP violated when bid >= TP
        if (trade.type === 'BUY') {
          if (trade.sl && currentBid <= trade.sl) {
            console.log(`[PriceService] ⚠️ SL hit for trade ${trade.id}: ${currentBid} <= ${trade.sl}`);
            await logger.log('message_received', `SL hit for trade ${trade.id}: ${currentBid} <= ${trade.sl}`);
            this.recentlyCheckedTrades.add(trade.id);
            await this.closeTradeWithRetry(trade.id);
          } else if (trade.tp && currentBid >= trade.tp) {
            console.log(`[PriceService] ✅ TP hit for trade ${trade.id}: ${currentBid} >= ${trade.tp}`);
            await logger.log('message_received', `TP hit for trade ${trade.id}: ${currentBid} >= ${trade.tp}`);
            this.recentlyCheckedTrades.add(trade.id);
            await this.closeTradeWithRetry(trade.id);
          }
        }
        // For SELL trades: SL violated when ask >= SL, TP violated when ask <= TP
        else if (trade.type === 'SELL') {
          if (trade.sl && currentAsk >= trade.sl) {
            console.log(`[PriceService] ⚠️ SL hit for trade ${trade.id}: ${currentAsk} >= ${trade.sl}`);
            await logger.log('message_received', `SL hit for trade ${trade.id}: ${currentAsk} >= ${trade.sl}`);
            this.recentlyCheckedTrades.add(trade.id);
            await this.closeTradeWithRetry(trade.id);
          } else if (trade.tp && currentAsk <= trade.tp) {
            console.log(`[PriceService] ✅ TP hit for trade ${trade.id}: ${currentAsk} <= ${trade.tp}`);
            await logger.log('message_received', `TP hit for trade ${trade.id}: ${currentAsk} <= ${trade.tp}`);
            this.recentlyCheckedTrades.add(trade.id);
            await this.closeTradeWithRetry(trade.id);
          }
        }
      }
    } catch (error: any) {
      console.error('[PriceService] Error checking SL/TP violations:', error.message);
    }
  }

  /**
   * Close a trade with retry logic
   */
  private async closeTradeWithRetry(tradeId: string): Promise<void> {
    try {
      await tradeManager.closeTradeManually(tradeId);
    } catch (error: any) {
      console.error(`[PriceService] Failed to close trade ${tradeId}:`, error.message);
      // If close fails, remove from recently checked so we can retry
      this.recentlyCheckedTrades.delete(tradeId);
    }
  }

  /**
   * Reset heartbeat timeout - if no heartbeat received, assume stream is dead
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
    }

    this.heartbeatTimeout = setTimeout(() => {
      console.warn('[PriceService] ⚠️ Heartbeat timeout - stream may be disconnected');
      this.isStreaming = false;
      
      // Try to reconnect
      if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
        const config = getConfig().then(c => c.trading?.symbol || 'XAU_USD');
        config.then(symbol => this.scheduleReconnect(symbol));
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  private scheduleReconnect(symbol: string): void {
    this.reconnectAttempts++;
    const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`[PriceService] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      if (this.isRunning && !this.isStreaming) {
        console.log(`[PriceService] Reconnecting... (attempt ${this.reconnectAttempts})`);
        const success = await this.startStreaming(symbol);
        if (!success && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect(symbol);
        } else if (!success) {
          console.warn('[PriceService] All reconnect attempts failed, falling back to polling');
          this.startPolling(symbol);
        }
      }
    }, delay);
  }

  /**
   * Start polling as fallback (every 5 seconds)
   */
  private startPolling(symbol: string): void {
    if (this.priceInterval) {
      console.log('[PriceService] Polling already active');
      return;
    }

    console.log(`[PriceService] 🔄 Starting price polling for ${symbol} every ${this.pollIntervalMs}ms`);

    // Fetch initial price
    this.fetchPrice(symbol).then(() => {
      console.log('[PriceService] Initial price fetched');
    });

    // Start polling interval
    this.priceInterval = setInterval(async () => {
      await this.fetchPrice(symbol);
    }, this.pollIntervalMs);
  }

  /**
   * Stop price service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Stop streaming
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    this.isStreaming = false;

    // Stop polling
    if (this.priceInterval) {
      clearInterval(this.priceInterval);
      this.priceInterval = null;
    }

    this.isRunning = false;
    console.log('[PriceService] Stopped');
    await logger.log('message_received', 'Price service stopped');
  }

  /**
   * Fetch current price from OANDA (polling fallback)
   */
  private async fetchPrice(symbol: string): Promise<void> {
    try {
      // Check if OANDA service is connected
      if (!oandaService.getStatus()) {
        // Silently skip if OANDA not connected
        return;
      }

      const priceData = await oandaService.getCurrentPrice(symbol);

      if (!priceData) {
        console.warn(`[PriceService] No price data received for ${symbol}`);
        return;
      }

      const bid = parseFloat(priceData.bid);
      const ask = parseFloat(priceData.ask);

      if (isNaN(bid) || isNaN(ask)) {
        console.error(`[PriceService] Invalid price data: bid=${priceData.bid}, ask=${priceData.ask}`);
        return;
      }

      const previousPrice = this.currentPrice;

      this.currentPrice = {
        symbol,
        bid,
        ask,
        spread: ask - bid,
        timestamp: new Date().toISOString()
      };

      // Log price change (only 1% of the time to avoid terminal spam)
      if (previousPrice) {
        if (Math.random() < 0.01) {
          const bidChange = bid - previousPrice.bid;
          const direction = bidChange >= 0 ? '↑' : '↓';
          console.log(`[PriceService] ${symbol}: ${bid} ${direction} (${bidChange >= 0 ? '+' : ''}${bidChange.toFixed(2)})`);
        }
      } else {
        console.log(`[PriceService] ${symbol}: ${bid} (initial poll)`);
      }

      // Broadcast via Socket.IO
      if (this.socketIO) {
        this.socketIO.emit('price_update', this.currentPrice);
      }

      // Update peak prices for all open trades (ATH tracking, independent of trailing stop)
      await this.updateAllTradePeaks();

      // Check for SL/TP violations
      await this.checkSLTPViolation();
    } catch (error: any) {
      // Silently handle errors - don't spam logs
      if (!error.message?.includes('401') && !error.message?.includes('404')) {
        console.error(`[PriceService] Error fetching price:`, error.message);
      }
    }
  }

  /**
   * Get current price
   */
  getCurrentPrice(): PriceData | null {
    return this.currentPrice;
  }

  /**
   * Get service status
   */
  getStatus(): boolean {
    return this.isRunning;
  }

  /**
   * Check if using streaming or polling
   */
  isUsingStreaming(): boolean {
    return this.isStreaming;
  }
}

export const priceService = new PriceService();
