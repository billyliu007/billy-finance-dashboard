import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import { resolveDashboardPayload } from '../services/dashboardService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const baseCurrency = req.auth.user.baseCurrency || 'USD';
    const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
    return res.json({ netWorth: payload.netWorth, portfolio: payload.portfolio });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

router.get('/net-worth', async (req, res, next) => {
  try {
    const baseCurrency = req.auth.user.baseCurrency || 'USD';
    const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
    return res.json(payload.netWorth);
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

router.get('/portfolio', async (req, res, next) => {
  try {
    const baseCurrency = req.auth.user.baseCurrency || 'USD';
    const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
    return res.json(payload.portfolio);
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

export default router;
