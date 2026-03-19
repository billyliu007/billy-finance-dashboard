import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import {
  createCryptoPositionFromCoinbaseProduct,
  createStockPositionFromSymbol,
  updatePosition,
  deletePosition,
  listPortfolioPositions,
  listPositionTransactions,
  createPositionTransaction,
  deletePositionTransaction,
  listHistoricalSaleTransactions,
  importHistoricalSaleTransactions,
  clearHistoricalSaleTransactions,
  getHistoricalSaleCount,
} from '../repositories/financeRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.post('/positions/crypto', async (req, res, next) => {
  try {
    const productId = String(req.body?.productId || '').trim();
    const qty = Number(req.body?.qty);
    const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
    const result = await createCryptoPositionFromCoinbaseProduct({
      userId: req.auth.user.userId,
      productId,
      qty,
      avgCostPerUnit,
    });
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    const status = /already exists/i.test(getErrorMessage(error)) ? 409 : 400;
    next(new ApiError(getErrorMessage(error), status));
  }
});

router.post('/positions/stock', async (req, res, next) => {
  try {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const qty = Number(req.body?.qty);
    const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
    const result = await createStockPositionFromSymbol({
      userId: req.auth.user.userId,
      symbol,
      qty,
      avgCostPerUnit,
    });
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    const status = /already exists/i.test(getErrorMessage(error)) ? 409 : 400;
    next(new ApiError(getErrorMessage(error), status));
  }
});

router.patch('/positions/:symbol', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const qty = Number(req.body?.qty);
    const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
    const result = await updatePosition({
      userId: req.auth.user.userId,
      symbol,
      qty,
      avgCostPerUnit,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const status = /not found/i.test(getErrorMessage(error)) ? 404 : 400;
    next(new ApiError(getErrorMessage(error), status));
  }
});

router.delete('/positions/:symbol', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const result = await deletePosition(req.auth.user.userId, symbol);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 404));
  }
});

router.get('/positions/:symbol/transactions', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const rows = await listPositionTransactions(req.auth.user.userId, symbol);
    return res.json({ transactions: rows });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.post('/positions/:symbol/transactions', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const txDate = String(req.body?.txDate || '').trim();
    const qty = Number(req.body?.qty);
    const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
    const type = req.body?.type ?? 'BUY';
    const costBasisPerUnit = req.body?.costBasisPerUnit ?? null;
    const notes = req.body?.notes ?? null;
    const deductCashId = req.body?.deductCashId ?? null;
    const creditCashId = req.body?.creditCashId ?? null;
    await createPositionTransaction({
      userId: req.auth.user.userId,
      symbol,
      txDate,
      qty,
      avgCostPerUnit,
      type,
      costBasisPerUnit,
      notes,
      deductCashId,
      creditCashId,
    });
    return res.status(201).json({ ok: true });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.get('/positions/:symbol/sales-history', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const rows = await listHistoricalSaleTransactions(req.auth.user.userId, symbol);
    return res.json({ history: rows });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.post('/positions/:symbol/sales-history/import', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const result = await importHistoricalSaleTransactions({ userId: req.auth.user.userId, symbol, rows });
    return res.status(201).json(result);
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.delete('/positions/:symbol/sales-history', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const result = await clearHistoricalSaleTransactions({ userId: req.auth.user.userId, symbol });
    return res.status(200).json(result);
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.get('/positions/:symbol/sales-history/count', async (req, res, next) => {
  try {
    const symbol = String(req.params?.symbol || '').trim().toUpperCase();
    const count = await getHistoricalSaleCount(req.auth.user.userId, symbol);
    return res.json({ count });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.delete('/transactions/:id', async (req, res, next) => {
  try {
    const transactionId = String(req.params?.id || '').trim();
    const result = await deletePositionTransaction({ userId: req.auth.user.userId, transactionId });
    return res.status(200).json(result);
  } catch (error) {
    const status = /not found/i.test(getErrorMessage(error)) ? 404 : 400;
    next(new ApiError(getErrorMessage(error), status));
  }
});

export default router;
