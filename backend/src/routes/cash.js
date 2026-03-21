import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { rethrowAsBadRequest } from '../lib/mapRouteErrors.js';
import { replaceCashComponents } from '../repositories/financeRepository.js';
import { getCrossFxRate, runCashTransfer } from '../services/cashTransferService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

/** Cross rate: destination_amount = source_amount * rate */
router.get(
  '/fx-rate',
  asyncHandler(async (req, res) => {
    const fromCur = String(req.query.from || '').trim();
    const toCur = String(req.query.to || '').trim();
    if (!fromCur || !toCur) {
      return res.status(400).json({ message: 'Query parameters "from" and "to" (currency codes) are required.' });
    }
    const { rate, from, to } = await getCrossFxRate(fromCur, toCur);
    return res.json({ from, to, rate });
  }),
);

router.post(
  '/transfer',
  asyncHandler(async (req, res) => {
    const fromCashId = String(req.body?.fromCashId || '').trim();
    const toCashId = String(req.body?.toCashId || '').trim();
    const amount = Number(req.body?.amount);
    const rawOverride = req.body?.fxRateOverride;
    const fxRateOverride =
      rawOverride === null || rawOverride === undefined || rawOverride === '' ? null : Number(rawOverride);
    if (!fromCashId || !toCashId) {
      return res.status(400).json({ message: 'fromCashId and toCashId are required.' });
    }
    try {
      const result = await runCashTransfer(req.auth.user.userId, {
        fromCashId,
        toCashId,
        amount,
        fxRateOverride,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
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
      rethrowAsBadRequest(error);
    }
  }),
);

export default router;
