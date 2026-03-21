import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveDashboardPayload } from '../services/dashboardService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const baseCurrency = req.auth.user.baseCurrency || 'USD';
    const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
    return res.json({
      netWorth: payload.netWorth,
      portfolio: payload.portfolio,
      benchmarks: payload.benchmarks ?? null,
    });
  }),
);

export default router;
