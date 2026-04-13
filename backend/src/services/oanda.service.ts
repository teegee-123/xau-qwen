import { getConfig } from '../storage/json-store';
import { logger } from './logger.service';

interface OandaOrder {
  instrument: string;
  units: number; // Positive for BUY, negative for SELL
  type?: 'MARKET' | 'LIMIT' | 'STOP';
  timeInForce?: 'FOK' | 'GTC' | 'IOC';
  positionFill?: 'DEFAULT';
  stopLossOnFill?: { price: string };
  takeProfitOnFill?: { price: string };
}

interface OandaTradeResult {
  tradeId: string;
  instrument: string;
  units: string;
  price: string;
  sl?: string;
  tp?: string;
  time: string;
}

interface OandaPosition {
  id: string;
  instrument: string;
  units: string;
  averagePrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  sl?: string;
  tp?: string;
  marginUsed: string;
}

interface OandaAccountInfo {
  id: string;
  balance: string;
  unrealizedPL: string;
  realizedPL: string;
  marginAvailable: string;
  marginUsed: string;
  openTradeCount: number;
  currency: string;
}

class OandaService {
  private baseUrl: string = '';
  private streamUrl: string = '';
  private accountId: string = '';
  private token: string = '';
  private isConnected = false;

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
  }

  async initialize(): Promise<void> {
    const config = await getConfig();

    // Check for OANDA config (new structure)
    const oandaConfig = (config as any).oanda;
    if (!oandaConfig || !oandaConfig.accountId || !oandaConfig.token) {
      throw new Error(
        'OANDA credentials not configured. Missing Account ID or Token. ' +
        'Please go to Config tab → OANDA Settings → Enter your credentials. ' +
        'Get free account at https://www.oanda.com'
      );
    }

    this.accountId = oandaConfig.accountId;
    this.token = oandaConfig.token;
    this.baseUrl = oandaConfig.environment === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';
    
    // Set streaming URL (separate domain from REST API)
    this.streamUrl = oandaConfig.environment === 'live'
      ? 'https://stream-fxtrade.oanda.com'
      : 'https://stream-fxpractice.oanda.com';

    await logger.log('message_received', `Initializing OANDA connection (accountId: ${this.accountId}, env: ${oandaConfig.environment})...`);

    // Test connection by getting account info
    try {
      const accountInfo = await this.getAccountInfo();
      this.isConnected = true;
      await logger.log('message_received', `OANDA connected successfully - Account: ${this.accountId}, Balance: ${accountInfo.balance} ${accountInfo.currency}`);

      // Auto-detect and correct gold symbol if needed
      try {
        const config = await getConfig();
        const currentSymbol = config.trading?.symbol;
        
        // Find available gold instrument
        const goldInstrument = await this.findGoldInstrument();
        
        if (goldInstrument && goldInstrument !== currentSymbol) {
          console.log(`[OANDA] Auto-correcting trading symbol from '${currentSymbol}' to '${goldInstrument}'`);
          config.trading!.symbol = goldInstrument;
          await require('../storage/json-store').updateConfig({ trading: config.trading });
          await logger.log('message_received', `OANDA auto-corrected symbol to ${goldInstrument} (was ${currentSymbol})`);
        } else if (goldInstrument === currentSymbol) {
          console.log(`[OANDA] Trading symbol '${currentSymbol}' is valid`);
        } else if (!goldInstrument) {
          console.warn(`[OANDA] No gold instrument found. Current symbol '${currentSymbol}' may not be tradeable.`);
          await logger.log('message_ignored', `No gold/XAU instrument available on this OANDA account. Current symbol: ${currentSymbol}`);
        }
      } catch (symbolError: any) {
        console.warn('[OANDA] Symbol auto-detection failed:', symbolError.message);
        // Don't fail initialization if symbol detection fails
      }
    } catch (error: any) {
      let errorMessage = error.message;

      // Provide helpful error messages
      if (error.message?.includes('401') || error.message?.includes('UNAUTHORIZED')) {
        errorMessage = 'Invalid OANDA API token. Please check your token in OANDA account settings.';
      } else if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
        errorMessage = 'Account not found. Please verify your OANDA Account ID.';
      } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
        errorMessage = 'Cannot connect to OANDA servers. Check your internet connection.';
      }

      await logger.log('message_ignored', `OANDA initialization failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Make authenticated HTTP request
   */
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/v3${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...((options as any)?.headers || {})
      },
      signal: AbortSignal.timeout(15000) // 15 second timeout
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OANDA API ${response.status}: ${errorBody}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Place a market order
   */
  async placeMarketOrder(order: OandaOrder): Promise<OandaTradeResult> {
    const units = order.units > 0 ? String(order.units) : `-${Math.abs(order.units)}`;

    const requestBody: any = {
      order: {
        units: units,
        instrument: order.instrument,
        timeInForce: order.timeInForce || 'FOK',
        type: 'MARKET',
        positionFill: 'DEFAULT'
      }
    };

    // Add SL/TP if provided
    if (order.stopLossOnFill) {
      requestBody.order.stopLossOnFill = order.stopLossOnFill;
    }
    if (order.takeProfitOnFill) {
      requestBody.order.takeProfitOnFill = order.takeProfitOnFill;
    }

    const response = await this.request<any>(`/accounts/${this.accountId}/orders`, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    // Extract trade info from response
    const fillTransaction = response.orderFillTransaction;
    const trade = fillTransaction.tradeOpened || fillTransaction.positionOpened;

    console.log('[OANDA] placeMarketOrder response:', {
      hasOrderFillTransaction: !!fillTransaction,
      hasTradeOpened: !!fillTransaction?.tradeOpened,
      hasPositionOpened: !!fillTransaction?.positionOpened,
      tradeId: trade?.id,
      tradeIdType: typeof trade?.id,
      tradePrice: trade?.price,
      fullResponseKeys: Object.keys(response)
    });

    if (!trade) {
      throw new Error('Order placed but no trade opened. Response: ' + JSON.stringify(response));
    }

    const result: OandaTradeResult = {
      tradeId: trade.id, // Keep as-is, don't String() undefined values
      instrument: order.instrument,
      units: trade.units,
      price: trade.price,
      sl: order.stopLossOnFill?.price,
      tp: order.takeProfitOnFill?.price,
      time: fillTransaction.time
    };

    console.log('[OANDA] placeMarketOrder result:', {
      tradeId: result.tradeId,
      tradeIdType: typeof result.tradeId,
      price: result.price,
      hasValidTradeId: !!result.tradeId && result.tradeId !== 'undefined'
    });

    const orderType = order.units > 0 ? 'BUY' : 'SELL';
    await logger.log('message_received', `OANDA ${orderType} order placed: ${order.instrument} ${units} @ ${trade.price} (Trade ID: ${trade.id})`);

    return result;
  }

  /**
   * Modify SL/TP for an open trade
   */
  async updateSLTP(tradeId: string, sl?: string, tp?: string): Promise<void> {
    const requestBody: any = {};

    if (sl) {
      requestBody.stopLoss = {
        price: sl,
        timeInForce: 'GTC'
      };
    }
    if (tp) {
      requestBody.takeProfit = {
        price: tp,
        timeInForce: 'GTC'
      };
    }

    // Correct OANDA v3 endpoint: PUT /accounts/{accountId}/trades/{tradeId}/orders
    await this.request(`/accounts/${this.accountId}/trades/${tradeId}/orders`, {
      method: 'PUT',
      body: JSON.stringify(requestBody)
    });

    await logger.log('message_received', `OANDA trade ${tradeId} SL/TP updated - SL: ${sl || 'unchanged'}, TP: ${tp || 'unchanged'}`);
  }

  /**
   * Close an open position
   */
  async closePosition(tradeId: string): Promise<{ pnl: string; closePrice: string }> {
    const response: any = await this.request(`/accounts/${this.accountId}/trades/${tradeId}/close`, {
      method: 'PUT'
    });

    console.log('[OANDA] closePosition - Full response structure:', JSON.stringify(response, null, 2).substring(0, 1000));

    const closeTransaction = response.orderFillTransaction;
    const closePrice = closeTransaction?.price || '0';

    // Try multiple possible PnL field locations
    const pnl = closeTransaction?.pl || 
                closeTransaction?.realizedPL || 
                closeTransaction?.tradeClosed?.realizedPL ||
                closeTransaction?.positionClosed?.realizedPL ||
                response?.pl || 
                '0';

    console.log('[OANDA] closePosition - Extracted values:', {
      closePrice,
      pnl,
      closeTransactionPL: closeTransaction?.pl,
      closeTransactionRealizedPL: closeTransaction?.realizedPL,
      tradeClosedPL: closeTransaction?.tradeClosed?.realizedPL,
      positionClosedPL: closeTransaction?.positionClosed?.realizedPL
    });

    await logger.log('message_received', `OANDA trade ${tradeId} closed @ ${closePrice}, PnL: ${pnl}`);

    return {
      pnl,
      closePrice
    };
  }

  /**
   * Get all open positions
   */
  async getOpenPositions(): Promise<OandaPosition[]> {
    const response = await this.request<{ positions: any[] }>(`/accounts/${this.accountId}/openPositions`);

    if (!response.positions || response.positions.length === 0) {
      return [];
    }

    return response.positions.map((pos: any) => ({
      id: pos.instrument, // OANDA uses instrument as position identifier
      instrument: pos.instrument,
      units: pos.units,
      averagePrice: pos.averagePrice,
      unrealizedPnl: pos.unrealizedPL || '0',
      realizedPnl: pos.realizedPL || '0',
      marginUsed: pos.marginUsed || '0'
    }));
  }

  /**
   * Get all open trades from OANDA
   * Returns trade objects with trade IDs that can be used for SL/TP updates and closing
   */
  async getOpenTrades(): Promise<Array<{
    id: string;
    instrument: string;
    units: string;
    price: string;
    sl?: string;
    tp?: string;
    unrealizedPL: string;
    createTime: string;
  }>> {
    try {
      const response = await this.request<{ trades: any[] }>(`/accounts/${this.accountId}/openTrades`);

      if (!response.trades || response.trades.length === 0) {
        console.log('[OANDA] No open trades found on account');
        return [];
      }

      return response.trades.map((trade: any) => ({
        id: trade.id,
        instrument: trade.instrument,
        units: trade.currentUnits,
        price: trade.price,
        sl: trade.stopLossOnFill?.price,
        tp: trade.takeProfitOnFill?.price,
        unrealizedPL: trade.unrealizedPL || '0',
        createTime: trade.createTime
      }));
    } catch (error: any) {
      console.error('[OANDA] Failed to get open trades:', error.message);
      return [];
    }
  }

  /**
   * Get account information
   */
  async getAccountInfo(): Promise<OandaAccountInfo> {
    const response = await this.request<{ account: any }>(`/accounts/${this.accountId}/summary`);

    const account = response.account;

    return {
      id: account.id,
      balance: account.balance,
      unrealizedPL: account.unrealizedPL || '0',
      realizedPL: account.pl || '0',
      marginAvailable: account.marginAvailable || '0',
      marginUsed: account.marginUsed || '0',
      openTradeCount: account.openTradeCount || 0,
      currency: account.currency
    };
  }

  /**
   * Get available instruments for the account
   */
  async getAccountInstruments(): Promise<Array<{ name: string; displayName?: string; type?: string }>> {
    try {
      const response = await this.request<{ instruments: any[] }>(`/accounts/${this.accountId}/instruments`);
      
      if (!response.instruments || response.instruments.length === 0) {
        console.warn('[OANDA] No instruments found for account');
        return [];
      }

      return response.instruments.map(inst => ({
        name: inst.name,
        displayName: inst.displayName,
        type: inst.type
      }));
    } catch (error: any) {
      console.error('[OANDA] Failed to fetch instruments:', error.message);
      return [];
    }
  }

  /**
   * Find gold/XAU instrument available on this account
   */
  async findGoldInstrument(): Promise<string | null> {
    try {
      const instruments = await this.getAccountInstruments();
      
      // Search for gold/XAU instruments
      const goldInstruments = instruments.filter(inst => 
        inst.name.includes('XAU') || 
        inst.name.includes('GOLD') ||
        inst.displayName?.toLowerCase().includes('gold')
      );

      if (goldInstruments.length > 0) {
        const symbol = goldInstruments[0].name;
        console.log(`[OANDA] Found ${goldInstruments.length} gold instrument(s). Using: ${symbol}`);
        if (goldInstruments.length > 1) {
          console.log('[OANDA] Available gold instruments:', goldInstruments.map(i => i.name).join(', '));
        }
        return symbol;
      }
      
      console.warn('[OANDA] No gold/XAU instrument found on this account');
      return null;
    } catch (error: any) {
      console.error('[OANDA] Error finding gold instrument:', error.message);
      return null;
    }
  }

  /**
   * Get current price for an instrument
   */
  async getCurrentPrice(instrument: string): Promise<{ bid: string; ask: string } | null> {
    try {
      const response = await this.request<{ prices: any[] }>(`/accounts/${this.accountId}/pricing?instruments=${instrument}`);

      if (response.prices && response.prices.length > 0) {
        const price = response.prices[0];
        return {
          bid: price.bids[0].price,
          ask: price.asks[0].price
        };
      }
      return null;
    } catch (error) {
      const errorMsg = (error as Error).message;
      
      // Provide helpful message for invalid instrument format
      if (errorMsg.includes('400') && errorMsg.includes('Invalid Instrument')) {
        const hint = instrument.includes('_') 
          ? '' 
          : ` (Hint: OANDA requires underscore format, e.g., '${instrument.replace('USD', '_USD')}')`;
        await logger.log('message_ignored', `Failed to get price for ${instrument}: ${errorMsg}${hint}`);
      } else {
        await logger.log('message_ignored', `Failed to get price for ${instrument}: ${errorMsg}`);
      }
      
      return null;
    }
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; accountInfo?: OandaAccountInfo }> {
    try {
      const oandaConfig = (await getConfig() as any).oanda;

      if (!oandaConfig || !oandaConfig.accountId || !oandaConfig.token) {
        return {
          success: false,
          message: 'OANDA credentials not configured. Go to Config → OANDA Settings → Enter Account ID and Token.'
        };
      }

      // Temporarily set config for testing
      this.accountId = oandaConfig.accountId;
      this.token = oandaConfig.token;
      this.baseUrl = oandaConfig.environment === 'live'
        ? 'https://api-fxtrade.oanda.com'
        : 'https://api-fxpractice.oanda.com';

      const accountInfo = await this.getAccountInfo();

      // Update config with test result
      const config = await getConfig();
      (config as any).oanda = (config as any).oanda || {};
      (config as any).oanda.lastTestedAt = new Date().toISOString();
      (config as any).oanda.lastTestResult = {
        success: true,
        message: `Connected - Balance: ${accountInfo.balance} ${accountInfo.currency}`
      };
      await require('../storage/json-store').updateConfig({ oanda: (config as any).oanda });

      await logger.log('message_received', `OANDA connection test successful - Account: ${this.accountId}, Balance: ${accountInfo.balance} ${accountInfo.currency}`);

      return {
        success: true,
        message: `Successfully connected to OANDA - Account ${this.accountId}, Balance: ${accountInfo.balance} ${accountInfo.currency}`,
        accountInfo
      };
    } catch (error: any) {
      let errorMessage = error.message;

      if (error.message?.includes('401') || error.message?.includes('UNAUTHORIZED')) {
        errorMessage = 'Invalid OANDA API token. Please check your token.';
      } else if (error.message?.includes('404') || error.message?.includes('NOT_FOUND')) {
        errorMessage = 'Account not found. Please verify your Account ID.';
      }

      // Update config with failed test result
      try {
        const config = await getConfig();
        (config as any).oanda = (config as any).oanda || {};
        (config as any).oanda.lastTestedAt = new Date().toISOString();
        (config as any).oanda.lastTestResult = {
          success: false,
          message: errorMessage
        };
        await require('../storage/json-store').updateConfig({ oanda: (config as any).oanda });
      } catch (e) {
        // Ignore config update error
      }

      await logger.log('message_ignored', `OANDA connection test failed: ${errorMessage}`);

      return {
        success: false,
        message: `Connection failed: ${errorMessage}`
      };
    }
  }

  getStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get the streaming base URL for price updates
   */
  getStreamingUrl(): string {
    return this.streamUrl;
  }

  /**
   * Get account ID for streaming requests
   */
  getAccountId(): string {
    return this.accountId;
  }

  /**
   * Get API token for streaming authentication
   */
  getToken(): string {
    return this.token;
  }
}

export const oandaService = new OandaService();
