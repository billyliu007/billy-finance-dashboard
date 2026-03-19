import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import { listCurrencies } from '../repositories/financeRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const currencies = await listCurrencies();
    return res.json({ currencies });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

export default router;
