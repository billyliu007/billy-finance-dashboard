import { buildNetWorthPayload } from './netWorthService.js';
import { listCashComponents, listNetWorthHistory, listPortfolioPositions, upsertNetWorthSnapshot } from '../repositories/financeRepository.js';
import { listUsersForSnapshots } from '../repositories/userRepository.js';
import { getCryptoQuoteMapForPositions, getLiveFxRates, getStockQuoteMapForPositions } from './marketDataService.js';

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
  let fxRates = await getLiveFxRates(currenciesFromCash);
  if (!fxLooksUsable(fxRates)) {
    await new Promise((r) => setTimeout(r, 750));
    fxRates = await getLiveFxRates(currenciesFromCash);
  }
  return fxRates;
}

export async function runDailySnapshots({ dateUtc = todayUtcDate() } = {}) {
  const users = await listUsersForSnapshots();
  const results = [];
  for (const user of users) {
    try {
      const [cashComponents, positions, history] = await Promise.all([
        listCashComponents(user.id),
        listPortfolioPositions(user.id),
        listNetWorthHistory(user.id),
      ]);
      const currenciesFromCash = [
        ...new Set((cashComponents || []).map((c) => String(c?.currency || '').toUpperCase()).filter(Boolean)),
      ];
      const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
        getStockQuoteMapForPositions(positions),
        getCryptoQuoteMapForPositions(positions),
        fetchFxWithRetry(currenciesFromCash),
      ]);
      const payloadCny = buildNetWorthPayload({
        cashComponents,
        positions,
        history,
        stockQuotes,
        cryptoQuotes,
        fxRatesOverride: fxRates,
        baseCurrency: 'CNY',
      });
      const totalCny = payloadCny.overview.totalNetWorth;
      const holdings = hasMeaningfulHoldings(cashComponents, positions);
      if (holdings && (!Number.isFinite(totalCny) || Math.abs(totalCny) < 1e-9)) {
        results.push({
          userId: user.id,
          status: 'skipped',
          message:
            'Net worth computed as zero while holdings exist (missing FX or prices). Snapshot not written.',
        });
        continue;
      }
      const usdRate = Number(fxRates.USD);
      const totalUsd =
        Number.isFinite(usdRate) && usdRate > 0 ? totalCny / usdRate : null;
      await upsertNetWorthSnapshot({
        userId: user.id,
        dateUtc,
        totalCny,
        totalUsd,
        qualityStatus: payloadCny.overview.missingInputs.length > 0 ? 'partial' : 'full',
      });
      results.push({ userId: user.id, status: 'ok' });
    } catch (error) {
      results.push({ userId: user.id, status: 'error', message: error?.message || 'snapshot failed' });
    }
  }
  return results;
}
