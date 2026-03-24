import { buildNetWorthPayload } from './netWorthService.js';
import {
  listCashComponents,
  listNetWorthHistory,
  listPortfolioPositions,
  listPositionTransactionAggregates,
  upsertDailyFxRateSet,
  upsertNetWorthSnapshot,
} from '../repositories/financeRepository.js';
import { listUsersForSnapshots } from '../repositories/userRepository.js';
import {
  getCryptoQuoteMapForPositions,
  getStockQuoteMapForPositions,
  isFxProviderFallbackEnabled,
  resolveLiveFxRates,
} from './marketDataService.js';
import { applyTransactionAggregatesToPositions } from './dashboardService.js';
import { fetchFxRatesWithFallback, mergeUsdPerUnitRates } from '../lib/fx.js';

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function hasMeaningfulHoldings(cashComponents, positions) {
  const cash = (cashComponents || []).some((c) => Number(c?.balance) !== 0);
  const pos = (positions || []).some((p) => Number(p?.qty) > 0);
  return cash || pos;
}

function fxLooksUsable(fxRates) {
  const usd = Number(fxRates?.USD);
  return Number.isFinite(usd) && usd > 0;
}

async function fetchFxWithRetry(currenciesFromCash) {
  let { rates: fxRates, providerLabel } = await resolveLiveFxRates(currenciesFromCash);
  if (!fxLooksUsable(fxRates)) {
    await new Promise((r) => setTimeout(r, 750));
    ({ rates: fxRates, providerLabel } = await resolveLiveFxRates(currenciesFromCash));
  }
  return { rates: fxRates, providerLabel };
}

export async function runDailySnapshots({ dateUtc = todayUtcDate() } = {}) {
  const users = await listUsersForSnapshots();
  const results = [];

  // 1. Fetch all user data in parallel (or batches if very large)
  // For now, doing all users to get a complete set of symbols/currencies
  const allUserData = await Promise.all(
    users.map(async (user) => {
      try {
        const [cashComponents, positions, history, txAggRows] = await Promise.all([
          listCashComponents(user.id),
          listPortfolioPositions(user.id),
          listNetWorthHistory(user.id),
          listPositionTransactionAggregates(user.id),
        ]);
        const effectivePositions = applyTransactionAggregatesToPositions(positions, txAggRows);
        return { user, cashComponents, positions: effectivePositions, history };
      } catch (err) {
        results.push({ userId: user.id, status: 'error', message: `failed to load user data: ${err.message}` });
        return null;
      }
    })
  );

  const activeUserData = allUserData.filter(Boolean);

  // 2. Collect all unique symbols and currencies across ALL users
  const allSymbols = new Set();
  const allCurrencies = new Set();

  for (const data of activeUserData) {
    for (const p of data.positions) {
      if (p.symbol) allSymbols.add(p.symbol);
    }
    for (const c of data.cashComponents) {
      if (c.currency) allCurrencies.add(String(c.currency).toUpperCase());
    }
  }

  // 3. Batch fetch market data ONCE for everyone
  const [stockQuotes, cryptoQuotes, fxBundle] = await Promise.all([
    getStockQuoteMapForPositions([...activeUserData.flatMap(d => d.positions)]),
    getCryptoQuoteMapForPositions([...activeUserData.flatMap(d => d.positions)]),
    fetchFxWithRetry([...allCurrencies]),
  ]);

  let fxRates = fxBundle.rates;
  let fxProvider = fxBundle.providerLabel;

  if (!fxLooksUsable(fxRates)) {
    return [{ status: 'error', message: 'FX rates unavailable, aborting snapshots' }];
  }

  // Persist CNY/USD pivot in fx_daily_rates: merge a full FX fetch if the batch map is missing CNY.
  let cnyUsdPivot = Number(fxRates.CNY);
  if (!Number.isFinite(cnyUsdPivot) || cnyUsdPivot <= 0) {
    const { rates: cnyPatch } = await fetchFxRatesWithFallback([], {
      disableFallback: !isFxProviderFallbackEnabled(),
    });
    fxRates = mergeUsdPerUnitRates(fxRates, cnyPatch);
    cnyUsdPivot = Number(fxRates.CNY);
  }

  const fxRateSetId = await upsertDailyFxRateSet({ dateUtc, provider: fxProvider, rates: fxRates });

  // 4. Process each user using the shared market data.
  // Snapshots are canonical USD + CNY (same math for every user). User display base currency is ignored here.
  // Multi-currency FX used for valuation is stored once per day in fx_daily_rates (fxRateSetId).
  const usdPerCny = Number.isFinite(cnyUsdPivot) && cnyUsdPivot > 0 ? cnyUsdPivot : null;
  const cnyFromUsd = (usdTotal) => {
    if (!Number.isFinite(usdTotal) || usdPerCny == null) return null;
    return usdTotal / usdPerCny;
  };

  for (const { user, cashComponents, positions, history } of activeUserData) {
    try {
      const payload = buildNetWorthPayload({
        cashComponents,
        positions,
        history,
        stockQuotes,
        cryptoQuotes,
        fxRatesOverride: fxRates,
        baseCurrency: 'USD',
      });

      const totalNetWorthUsd = payload.overview.totalNetWorth;
      const finalTotalUsd = Number.isFinite(totalNetWorthUsd) ? totalNetWorthUsd : null;
      const finalTotalCny = finalTotalUsd != null ? cnyFromUsd(finalTotalUsd) : null;

      const holdings = hasMeaningfulHoldings(cashComponents, positions);
      if (
        holdings
        && (finalTotalUsd == null || !Number.isFinite(finalTotalUsd) || Math.abs(finalTotalUsd) < 1e-9)
      ) {
        results.push({
          userId: user.id,
          status: 'skipped',
          message: 'Net worth computed as zero while holdings exist. Snapshot not written.',
        });
        continue;
      }

      const missingCnyRate = finalTotalCny == null || !Number.isFinite(finalTotalCny);
      const qualityStatus =
        payload.overview.missingInputs.length > 0 || missingCnyRate ? 'partial' : 'full';

      await upsertNetWorthSnapshot({
        userId: user.id,
        dateUtc,
        totalCny: Number.isFinite(finalTotalCny) ? finalTotalCny : null,
        totalUsd: finalTotalUsd,
        fxRateSetId,
        qualityStatus,
      });

      results.push({ userId: user.id, status: 'ok' });
    } catch (error) {
      results.push({ userId: user.id, status: 'error', message: error?.message || 'snapshot logic failed' });
    }
  }

  return results;
}
