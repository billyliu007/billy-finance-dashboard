import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { rethrowAsBadRequest, rethrowAsNotFoundOr400 } from '../lib/mapRouteErrors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createWhatIfScenario,
  deleteWhatIfScenario,
  listWhatIfHypotheticalPurchases,
  listWhatIfScenarios,
  listWhatIfTargetPrices,
  replaceWhatIfHypotheticalPurchases,
  replaceWhatIfTargetPrices,
  setWhatIfScenarioActive,
  updateWhatIfScenario,
} from '../repositories/financeRepository.js';
import { computeWhatIfScenarioResults } from '../services/whatIfScenarioService.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/scenarios',
  asyncHandler(async (req, res) => {
    const userId = req.auth.user.userId;
    const rows = await listWhatIfScenarios(userId);
    return res.json({
      scenarios: rows,
      activeScenarioId: rows.find((item) => item.isActive)?.id ?? null,
    });
  }),
);

router.post(
  '/scenarios',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const name = req.body?.name;
      const makeActive = req.body?.makeActive !== false;
      const scenario = await createWhatIfScenario({ userId, name, makeActive });
      return res.status(201).json({ scenario });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.put(
  '/scenarios/:id',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const name = req.body?.name;
      const scenario = await updateWhatIfScenario({ userId, scenarioId, name });
      return res.json({ scenario });
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.post(
  '/scenarios/:id/activate',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      await setWhatIfScenarioActive({ userId, scenarioId });
      return res.status(200).json({ ok: true });
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.delete(
  '/scenarios/:id',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const result = await deleteWhatIfScenario({ userId, scenarioId });
      return res.status(200).json(result);
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.put(
  '/scenarios/:id/inputs',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const targetRows = Array.isArray(req.body?.targetPrices) ? req.body.targetPrices : [];
      const buyRows = Array.isArray(req.body?.hypotheticalPurchases) ? req.body.hypotheticalPurchases : [];
      await Promise.all([
        replaceWhatIfTargetPrices({ userId, scenarioId, rows: targetRows }),
        replaceWhatIfHypotheticalPurchases({ userId, scenarioId, rows: buyRows }),
      ]);
      const baseCurrency = req.auth.user.baseCurrency || 'USD';
      const results = await computeWhatIfScenarioResults({ userId, scenarioId, baseCurrency });
      return res.json(results);
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.put(
  '/scenarios/:id/target-prices',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const targetPrices = await replaceWhatIfTargetPrices({ userId, scenarioId, rows });
      return res.json({ targetPrices });
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.get(
  '/scenarios/:id/target-prices',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const targetPrices = await listWhatIfTargetPrices({ userId, scenarioId });
      return res.json({ targetPrices });
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.put(
  '/scenarios/:id/hypothetical-purchases',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const hypotheticalPurchases = await replaceWhatIfHypotheticalPurchases({ userId, scenarioId, rows });
      return res.json({ hypotheticalPurchases });
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.get(
  '/scenarios/:id/hypothetical-purchases',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const hypotheticalPurchases = await listWhatIfHypotheticalPurchases({ userId, scenarioId });
      return res.json({ hypotheticalPurchases });
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

router.get(
  '/scenarios/:id/results',
  asyncHandler(async (req, res) => {
    try {
      const t0 = Number(process.hrtime.bigint() / 1000000n);
      const userId = req.auth.user.userId;
      const scenarioId = req.params?.id;
      const baseCurrency = req.auth.user.baseCurrency || 'USD';
      const results = await computeWhatIfScenarioResults({ userId, scenarioId, baseCurrency });
      const t1 = Number(process.hrtime.bigint() / 1000000n);
      if (['1', 'true', 'yes', 'on'].includes(String(process.env.WHATIF_TIMING_LOG || '').trim().toLowerCase())) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            { tag: 'whatif_route_timing', route: 'GET /results', userId, scenarioId, ms: t1 - t0, at: new Date().toISOString() },
            null,
            0,
          ),
        );
      }
      return res.json(results);
    } catch (error) {
      rethrowAsNotFoundOr400(error);
    }
  }),
);

export default router;
