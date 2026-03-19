import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveProfitabilityPayload } from '../services/profitabilityService.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const baseCurrency = req.auth.user.baseCurrency || 'USD';
    const from = req.query?.from != null ? String(req.query.from) : null;
    const to = req.query?.to != null ? String(req.query.to) : null;
    const payload = await resolveProfitabilityPayload(req.auth.user.userId, baseCurrency, { from, to });
    return res.json(payload);
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

export default router;

