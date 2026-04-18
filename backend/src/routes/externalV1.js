import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ApiError } from '../lib/ApiError.js';
import { rethrowAsBadRequest } from '../lib/mapRouteErrors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  listHistoricalSaleTransactions,
  listPositionTransactions,
  listWhatIfHypotheticalPurchases,
  listWhatIfHypotheticalSales,
  listWhatIfTargetPrices,
  mapTargetPricesToExpectedPrices,
  resolveWhatIfScenarioForPlanLookup,
} from '../repositories/financeRepository.js';
import { listCashComponents } from '../repositories/cashRepository.js';
import { resolveDashboardPayload } from '../services/dashboardService.js';
import { buildCashUsdDetailForApi } from '../services/netWorthService.js';
import { getLiveFxRates } from '../services/marketDataService.js';
import { parseIncludeHistoricalSellsQuery } from '../lib/externalV1Query.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/me/net-worth',
  asyncHandler(async (req, res) => {
    const payload = await resolveDashboardPayload(req.auth.user.userId, 'USD');
    const { overview } = payload.netWorth;
    return res.json({
      baseCurrency: 'USD',
      hasData: overview.hasData,
      totalNetWorth: overview.totalNetWorth,
      missingInputs: overview.missingInputs,
      componentValues: (overview.componentValues || []).map((c) => ({
        key: c.key,
        name: c.name,
        value: c.value,
        valueUsd: c.valueUsd,
        found: c.found,
      })),
    });
  }),
);

router.get(
  '/me/cash',
  asyncHandler(async (req, res) => {
    const userId = req.auth.user.userId;
    const cashComponents = await listCashComponents(userId);
    const currencies = [
      ...new Set((cashComponents || []).map((c) => String(c?.currency || '').toUpperCase()).filter(Boolean)),
    ];
    const fxRates = await getLiveFxRates(currencies);
    const accounts = buildCashUsdDetailForApi(cashComponents, fxRates);
    const totalUsd = accounts.reduce((sum, a) => sum + (Number.isFinite(a.valueUsd) ? a.valueUsd : 0), 0);
    return res.json({
      baseCurrency: 'USD',
      accounts,
      totalUsd,
    });
  }),
);

router.get(
  '/me/scenario-plan',
  asyncHandler(async (req, res) => {
    const userId = req.auth.user.userId;
    const raw = req.query?.planName ?? req.query?.name;
    const planName = raw == null || String(raw).trim() === '' ? null : String(raw).trim();
    const scenario = await resolveWhatIfScenarioForPlanLookup({ userId, planName });
    if (!scenario) {
      throw new ApiError(
        planName ? 'Scenario plan not found for this name.' : 'No active scenario plan.',
        404,
      );
    }
    const scenarioId = scenario.id;
    const [hypotheticalPurchases, hypotheticalSales, targetRows] = await Promise.all([
      listWhatIfHypotheticalPurchases({ userId, scenarioId }),
      listWhatIfHypotheticalSales({ userId, scenarioId }),
      listWhatIfTargetPrices({ userId, scenarioId }),
    ]);
    return res.json({
      scenarioId,
      scenarioName: scenario.name,
      isActive: Boolean(scenario.isActive),
      hypotheticalPurchases,
      hypotheticalSales,
      expectedPrices: mapTargetPricesToExpectedPrices(targetRows),
    });
  }),
);

router.get(
  '/me/holdings',
  asyncHandler(async (req, res) => {
    const { portfolio } = await resolveDashboardPayload(req.auth.user.userId, 'USD');
    return res.json({
      baseCurrency: 'USD',
      isEmpty: portfolio.isEmpty,
      totals: portfolio.totals,
      totalPnlPct: portfolio.totalPnlPct,
      tableRows: portfolio.tableRows,
    });
  }),
);

router.get(
  '/me/positions/:symbol/transactions',
  asyncHandler(async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const includeHistorical = parseIncludeHistoricalSellsQuery(req.query);
      const userId = req.auth.user.userId;
      const transactions = await listPositionTransactions(userId, symbol);
      const body = { symbol, transactions };
      if (includeHistorical) {
        body.historicalSells = await listHistoricalSaleTransactions(userId, symbol);
      }
      return res.json(body);
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

export default router;
