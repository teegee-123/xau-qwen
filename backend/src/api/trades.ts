import { Router } from 'express';
import {
  getTradesByStrategy,
  getOpenTradesByStrategy,
  getClosedTradesByStrategy,
  attachStrategyNames,
  updateTrade
} from '../storage/json-store';
import { tradeManager } from '../services/trade-manager';
import { priceService } from '../services/price.service';
import { logger } from '../services/logger.service';

const router = Router();

// Helper to merge in-memory peak price and strategy name into trade objects
const enrichTrades = async (trades: any[]) => {
  const withPeaks = trades.map(trade => {
    if (!trade.peakPrice) {
      const peak = priceService.getTradePeakPrice(trade.id);
      if (peak) trade.peakPrice = peak;
    }
    return trade;
  });
  return attachStrategyNames(withPeaks);
};

// Get all trades (optionally filtered by strategy)
router.get('/', async (req, res) => {
  try {
    const { strategyId } = req.query;
    const trades = await getTradesByStrategy(strategyId as string | undefined);
    res.json(await enrichTrades(trades));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get open trades (optionally filtered by strategy)
router.get('/open', async (req, res) => {
  try {
    const { strategyId } = req.query;
    const trades = await getOpenTradesByStrategy(strategyId as string | undefined);
    res.json(await enrichTrades(trades));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get closed trades (optionally filtered by strategy)
router.get('/closed', async (req, res) => {
  try {
    const { strategyId } = req.query;
    const trades = await getClosedTradesByStrategy(strategyId as string | undefined);
    res.json(await enrichTrades(trades));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Close trade manually
router.post('/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    await tradeManager.closeTradeManually(id);
    res.json({ success: true });
  } catch (error: any) {
    await logger.log('message_ignored', `Failed to close trade: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get PnL history for chart (optionally filtered by strategy)
router.get('/pnl-history', async (req, res) => {
  try {
    const { strategyId } = req.query;
    const trades = await getClosedTradesByStrategy(strategyId as string | undefined);

    // Filter trades with PnL and sort by close time
    const pnlData = trades
      .filter(t => t.closeTime && t.pnl !== undefined)
      .sort((a, b) => new Date(a.closeTime!).getTime() - new Date(b.closeTime!).getTime())
      .map(t => ({
        date: t.closeTime,
        pnl: t.pnl || 0,
        symbol: t.symbol,
        type: t.type
      }));

    // Calculate cumulative PnL
    let cumulative = 0;
    const result = pnlData.map(d => {
      cumulative += d.pnl;
      return {
        ...d,
        cumulative
      };
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
