import { Router } from 'express';
import { getTrades, getOpenTrades, getClosedTrades, updateTrade } from '../storage/json-store';
import { tradeManager } from '../services/trade-manager';
import { priceService } from '../services/price.service';
import { logger } from '../services/logger.service';

const router = Router();

// Helper to merge in-memory peak price into trade objects
const attachPeakPrice = (trades: any[]) => {
    return trades.map(trade => {
        // If peak not in DB, check memory
        if (!trade.peakPrice) {
            const peak = priceService.getTradePeakPrice(trade.id);
            if (peak) trade.peakPrice = peak;
        }
        return trade;
    });
};

// Get all trades
router.get('/', async (req, res) => {
  try {
    const trades = await getTrades();
    res.json(attachPeakPrice(trades));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get open trades
router.get('/open', async (req, res) => {
  try {
    const trades = await tradeManager.getActiveTrades();
    res.json(attachPeakPrice(trades));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get closed trades
router.get('/closed', async (req, res) => {
  try {
    const trades = await getClosedTrades();
    res.json(attachPeakPrice(trades));
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

// Get PnL history for chart
router.get('/pnl-history', async (req, res) => {
  try {
    const trades = await getClosedTrades();
    
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
