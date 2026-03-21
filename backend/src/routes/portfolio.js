import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  rethrowAsBadRequest,
  rethrowAsCreateConflict,
  rethrowAsNotFound404,
  rethrowAsNotFoundOr400,
  rethrowAsUpdateNotFound,
} from '../lib/mapRouteErrors.js';
import {
  createCryptoPositionFromCoinbaseProduct,
  createStockPositionFromSymbol,
  updatePosition,
  deletePosition,
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

router.post(
  '/positions/crypto',
  asyncHandler(async (req, res) => {
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
      rethrowAsCreateConflict(error);
    }
  }),
);

router.post(
  '/positions/stock',
  asyncHandler(async (req, res) => {
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
      rethrowAsCreateConflict(error);
    }
  }),
);

router.patch(
  '/positions/:symbol',
  asyncHandler(async (req, res) => {
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
      rethrowAsUpdateNotFound(error);
    }
  }),
);

router.delete(
  '/positions/:symbol',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const result = await deletePosition(req.auth.user.userId, symbol);
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      rethrowAsNotFound404(error);
    }
  }),
);

router.get(
  '/positions/:symbol/transactions',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const rows = await listPositionTransactions(req.auth.user.userId, symbol);
      return res.json({ transactions: rows });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.post(
  '/positions/:symbol/transactions',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const txDate = String(req.body?.txDate || '').trim();
      const qty = Number(req.body?.qty);
      const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
      const feeFlat = req.body?.feeFlatTotal == null ? req.body?.feeFlat : req.body?.feeFlatTotal;
      const feePerUnit = req.body?.feePerUnit == null ? null : Number(req.body?.feePerUnit); // legacy
      const feeFlatTotal = feeFlat == null ? null : Number(feeFlat);
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
        feeFlatTotal,
        feePerUnit,
        notes,
        deductCashId,
        creditCashId,
      });
      return res.status(201).json({ ok: true });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.get(
  '/positions/:symbol/sales-history',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const rows = await listHistoricalSaleTransactions(req.auth.user.userId, symbol);
      return res.json({ history: rows });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.post(
  '/positions/:symbol/sales-history/import',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const result = await importHistoricalSaleTransactions({ userId: req.auth.user.userId, symbol, rows });
      return res.status(201).json(result);
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.delete(
  '/positions/:symbol/sales-history',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const result = await clearHistoricalSaleTransactions({ userId: req.auth.user.userId, symbol });
      return res.status(200).json(result);
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.get(
  '/positions/:symbol/sales-history/count',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const count = await getHistoricalSaleCount(req.auth.user.userId, symbol);
      return res.json({ count });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.delete(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    try {
      const transactionId = String(req.params?.id || '').trim();
      const result = await deletePositionTransaction({ userId: req.auth.user.userId, transactionId });
      return res.status(200).json(result);
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

export default router;
