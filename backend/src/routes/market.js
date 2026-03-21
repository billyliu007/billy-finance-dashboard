import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { listCoinbaseProducts, listUsStockSymbols } from '../repositories/financeRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/coinbase-products',
  asyncHandler(async (req, res) => {
    const queryText = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 200);
    const products = await listCoinbaseProducts({ queryText, limit });
    return res.json({ products });
  }),
);

router.get(
  '/us-stock-symbols',
  asyncHandler(async (req, res) => {
    const queryText = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 50);
    const symbols = await listUsStockSymbols({ queryText, limit });
    return res.json({ symbols });
  }),
);

export default router;
