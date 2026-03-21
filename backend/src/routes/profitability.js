import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveProfitabilityPayload } from '../services/profitabilityService.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = req.query?.from != null ? String(req.query.from) : null;
    const to = req.query?.to != null ? String(req.query.to) : null;
    const payload = await resolveProfitabilityPayload(req.auth.user.userId, { from, to });
    return res.json(payload);
  }),
);

export default router;
