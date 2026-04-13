import { Router } from 'express';
import {
  getStrategies,
  addStrategy,
  updateStrategy,
  deleteStrategy,
  activateStrategy,
  getActiveStrategy,
  Strategy
} from '../storage/json-store';
import { logger } from '../services/logger.service';

const router = Router();

// Get all strategies
router.get('/', async (req, res) => {
  try {
    const strategies = await getStrategies();
    res.json(strategies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new strategy
router.post('/', async (req, res) => {
  try {
    const { name, channels, trading } = req.body as {
      name: string;
      channels: string[];
      trading: Strategy['trading'];
    };

    if (!name) {
      return res.status(400).json({ error: 'Strategy name is required' });
    }

    const strategies = await getStrategies();

    const newStrategy = await addStrategy({
      name,
      isActive: strategies.length === 0, // First strategy is active
      channels: channels || [],
      trading: {
        lotSize: trading?.lotSize ?? 0.01,
        symbol: trading?.symbol ?? 'XAU_USD',
        closeTimeoutMinutes: trading?.closeTimeoutMinutes ?? 3,
        maxRetries: trading?.maxRetries ?? 3,
        retryDelayMs: trading?.retryDelayMs ?? 2000,
        trailingStopDistance: trading?.trailingStopDistance ?? 0,
        listenToReplies: trading?.listenToReplies ?? false
      }
    });

    await logger.log('message_received', `Strategy created: ${newStrategy.name} (${newStrategy.id})`);
    res.status(201).json(newStrategy);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update strategy
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body as Partial<Strategy>;

    const updated = await updateStrategy(id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    await logger.log('message_received', `Strategy updated: ${updated.name}`);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete strategy
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await deleteStrategy(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    await logger.log('message_received', `Strategy deleted: ${id}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Activate strategy (set as live, deactivate all others)
router.post('/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;

    const strategies = await activateStrategy(id);
    const activated = strategies.find(s => s.id === id);

    await logger.log('message_received', `Strategy activated: ${activated?.name}`);
    res.json(strategies);
  } catch (error: any) {
    if (error.message === 'Strategy not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get active strategy
router.get('/active', async (req, res) => {
  try {
    const active = await getActiveStrategy();
    if (!active) {
      return res.status(404).json({ error: 'No active strategy found' });
    }
    res.json(active);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
