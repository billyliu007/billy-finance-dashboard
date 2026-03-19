import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import { runDailySnapshots } from '../services/snapshotService.js';

const router = Router();

router.post('/snapshot/daily', async (req, res, next) => {
  const token = String(req.headers['x-cron-token'] || '');
  const expectedToken = String(process.env.SNAPSHOT_CRON_TOKEN || '');
  if (!expectedToken || token !== expectedToken) {
    return res.status(401).json({ message: 'Unauthorized cron invocation.' });
  }
  try {
    const results = await runDailySnapshots();
    return res.status(200).json({ ok: true, results });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

export default router;
