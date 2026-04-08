import { Router } from 'express';
import { clearTrades, clearLogs } from '../storage/json-store';
import { logger } from '../services/logger.service';

const router = Router();

// Clear all trades and logs
router.delete('/reset', async (req, res) => {
  try {
    await clearTrades();
    await clearLogs();
    
    await logger.log('message_received', 'All trades and logs cleared by user');
    
    res.json({
      success: true,
      message: 'All trades and logs have been cleared'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
