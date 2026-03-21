import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { listCurrencies } from '../repositories/financeRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const currencies = await listCurrencies();
    return res.json({ currencies });
  }),
);

export default router;
