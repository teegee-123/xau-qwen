import { Router } from 'express';
import { oandaService } from '../services/oanda.service';
import { priceService } from '../services/price.service';
import { logger } from '../services/logger.service';

const router = Router();

// Test OANDA connection
router.post('/test', async (req, res) => {
  try {
    const testPromise = oandaService.testConnection();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('OANDA connection test timed out after 15 seconds')), 15000);
    });

    const result = await Promise.race([testPromise, timeout]);
    res.json(result);
  } catch (error: any) {
    await logger.log('message_ignored', `OANDA test connection failed: ${error.message}`);
    res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`
    });
  }
});

// Get OANDA account info
router.get('/account', async (req, res) => {
  try {
    const connected = oandaService.getStatus();

    if (!connected) {
      return res.json({
        connected: false,
        message: 'OANDA not connected'
      });
    }

    const accountInfo = await oandaService.getAccountInfo();

    res.json({
      connected: true,
      balance: parseFloat(accountInfo.balance),
      equity: parseFloat(accountInfo.balance) + parseFloat(accountInfo.unrealizedPL),
      margin: parseFloat(accountInfo.marginUsed),
      freeMargin: parseFloat(accountInfo.marginAvailable),
      currency: accountInfo.currency,
      login: accountInfo.id,
      server: 'OANDA',
      unrealizedPL: parseFloat(accountInfo.unrealizedPL),
      realizedPL: parseFloat(accountInfo.realizedPL),
      openTradeCount: accountInfo.openTradeCount
    });
  } catch (error: any) {
    res.status(500).json({
      connected: false,
      error: error.message
    });
  }
});

// Reconnect OANDA
router.post('/reconnect', async (req, res) => {
  try {
    await logger.log('message_received', 'OANDA reconnection requested');

    const reconnectPromise = oandaService.initialize();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('OANDA reconnection timed out after 15 seconds')), 15000);
    });

    await Promise.race([reconnectPromise, timeout]);

    const connected = oandaService.getStatus();
    if (connected) {
      const accountInfo = await oandaService.getAccountInfo();
      res.json({
        success: true,
        message: 'OANDA reconnected successfully',
        accountInfo: {
          balance: accountInfo.balance,
          currency: accountInfo.currency,
          login: accountInfo.id
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'OANDA initialization completed but not connected'
      });
    }
  } catch (error: any) {
    await logger.log('message_ignored', `OANDA reconnection failed: ${error.message}`);
    res.status(500).json({
      success: false,
      message: `Reconnection failed: ${error.message}`
    });
  }
});

// Get current price for instrument
router.get('/price/:instrument', async (req, res) => {
  try {
    const { instrument } = req.params;
    const price = await oandaService.getCurrentPrice(instrument);

    if (!price) {
      return res.status(404).json({
        success: false,
        message: `Failed to fetch price for ${instrument}`
      });
    }

    res.json({
      success: true,
      bid: price.bid,
      ask: price.ask,
      instrument
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Failed to fetch price: ${error.message}`
    });
  }
});

// Get current tracked price from price service
router.get('/price', (req, res) => {
  try {
    const currentPrice = priceService.getCurrentPrice();
    
    if (!currentPrice) {
      return res.json({
        success: false,
        message: 'No price data available. Price service may not be running.',
        running: priceService.getStatus()
      });
    }

    res.json({
      success: true,
      ...currentPrice,
      serviceRunning: priceService.getStatus()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: `Failed to get current price: ${error.message}`
    });
  }
});

export default router;
