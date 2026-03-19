import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import { replaceCashComponents } from '../repositories/financeRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.put('/', async (req, res, next) => {
  try {
    const list = Array.isArray(req.body?.cashComponents) ? req.body.cashComponents : [];
    const normalized = list.map((item, index) => {
      const name = String(item?.name ?? `Component ${index + 1}`).trim() || 'Cash';
      const currency = String(item?.currency || 'CNY').trim().toUpperCase();
      const balance = Number(item?.balance ?? item?.amount ?? 0);
      if (!Number.isFinite(balance)) {
        throw new Error('Each cash component must have a valid balance (number).');
      }
      if (balance === 0) {
        throw new Error('Balance cannot be zero. Use a positive value for cash or negative for debt.');
      }
      return { name, currency, balance };
    });
    await replaceCashComponents(req.auth.user.userId, normalized);
    return res.status(200).json({ ok: true });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

export default router;
