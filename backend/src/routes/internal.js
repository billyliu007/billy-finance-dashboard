import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { runDailySnapshots } from '../services/snapshotService.js';

const router = Router();

router.post(
  '/snapshot/daily',
  asyncHandler(async (req, res) => {
    const token = String(req.headers['x-cron-token'] || '');
    const expectedToken = String(process.env.SNAPSHOT_CRON_TOKEN || '');
    if (!expectedToken || token !== expectedToken) {
      return res.status(401).json({ message: 'Unauthorized cron invocation.' });
    }
    const results = await runDailySnapshots();
    return res.status(200).json({ ok: true, results });
  }),
);

export default router;
