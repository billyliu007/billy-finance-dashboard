import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import {
  listCoinbaseProducts,
  listUsStockSymbols,
} from '../repositories/financeRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get('/coinbase-products', async (req, res, next) => {
  try {
    const queryText = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 200);
    const products = await listCoinbaseProducts({ queryText, limit });
    return res.json({ products });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

router.get('/us-stock-symbols', async (req, res, next) => {
  try {
    const queryText = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 50);
    const symbols = await listUsStockSymbols({ queryText, limit });
    return res.json({ symbols });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 500));
  }
});

export default router;
