import { Router } from 'express';
import { getConfig, updateConfig, Config } from '../storage/json-store';
import { logger } from '../services/logger.service';

const router = Router();

// Get config
router.get('/', async (req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update config
router.put('/', async (req, res) => {
  try {
    const updates: Partial<Config> = req.body;
    const config = await updateConfig(updates);
    res.json(config);
  } catch (error: any) {
    await logger.log('message_ignored', `Failed to update config: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
