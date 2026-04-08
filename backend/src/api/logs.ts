import { Router } from 'express';
import { getLogs } from '../storage/json-store';

const router = Router();

// Get all logs with pagination, newest-first by default
router.get('/', async (req, res) => {
  try {
    const allLogs = await getLogs();

    // Support pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;

    // Logs are stored oldest-first; return newest-first so recent logs load first
    const sorted = [...allLogs].reverse();

    const start = (page - 1) * limit;
    const end = Math.min(start + limit, sorted.length);

    res.json({
      logs: sorted.slice(start, end),
      total: sorted.length,
      page,
      limit,
      hasMore: end < sorted.length
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
