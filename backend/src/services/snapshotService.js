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

  // 1. Fetch all user data in parallel (or batches if very large)
  // For now, doing all users to get a complete set of symbols/currencies
  const allUserData = await Promise.all(
    users.map(async (user) => {
      try {
        const [cashComponents, positions, history] = await Promise.all([
          listCashComponents(user.id),
          listPortfolioPositions(user.id),
          listNetWorthHistory(user.id),
        ]);
        return { user, cashComponents, positions, history };
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
  const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
    getStockQuoteMapForPositions([...activeUserData.flatMap(d => d.positions)]),
    getCryptoQuoteMapForPositions([...activeUserData.flatMap(d => d.positions)]),
    fetchFxWithRetry([...allCurrencies]),
  ]);

  if (!fxLooksUsable(fxRates)) {
    return [{ status: 'error', message: 'FX rates unavailable, aborting snapshots' }];
  }

  // 4. Process each user using the shared market data
  for (const { user, cashComponents, positions, history } of activeUserData) {
    try {
      const payload = buildNetWorthPayload({
        cashComponents,
        positions,
        history,
        stockQuotes,
        cryptoQuotes,
        fxRatesOverride: fxRates,
        baseCurrency: user.base_currency || 'USD',
      });

      const totalUsd = payload.overview.totalNetWorth * (fxRates[user.base_currency || 'USD'] || 1);
      // Wait, buildNetWorthPayload returns totalNetWorth in baseCurrency. 
      // If baseCurrency is USD, totalNetWorth is USD.
      // If baseCurrency is CNY, totalNetWorth is CNY.
      // We want to store totalUsd and totalCny.
      
      const usdToCny = 1 / (fxRates.CNY || 0.14);
      const totalNetWorthInBase = payload.overview.totalNetWorth;
      const base = user.base_currency || 'USD';
      
      let finalTotalUsd = 0;
      let finalTotalCny = 0;

      if (base === 'USD') {
        finalTotalUsd = totalNetWorthInBase;
        finalTotalCny = totalNetWorthInBase * usdToCny;
      } else if (base === 'CNY') {
        finalTotalCny = totalNetWorthInBase;
        finalTotalUsd = totalNetWorthInBase * (fxRates.CNY || 0);
      } else {
        // Base is something else (e.g. EUR)
        // totalInBase = totalUsd * (1 / rateToUsd) => totalUsd = totalInBase * rateToUsd
        const rateToUsd = fxRates[base] || 0;
        finalTotalUsd = totalNetWorthInBase * rateToUsd;
        finalTotalCny = finalTotalUsd * usdToCny;
      }

      const holdings = hasMeaningfulHoldings(cashComponents, positions);
      if (holdings && (!Number.isFinite(finalTotalUsd) || Math.abs(finalTotalUsd) < 1e-9)) {
        results.push({
          userId: user.id,
          status: 'skipped',
          message: 'Net worth computed as zero while holdings exist. Snapshot not written.',
        });
        continue;
      }

      await upsertNetWorthSnapshot({
        userId: user.id,
        dateUtc,
        totalCny: finalTotalCny,
        totalUsd: finalTotalUsd,
        qualityStatus: payload.overview.missingInputs.length > 0 ? 'partial' : 'full',
        metadata: {
          fx_rates: fxRates,
          base_currency: base,
          computed_at: new Date().toISOString(),
        }
      });

      results.push({ userId: user.id, status: 'ok' });
    } catch (error) {
      results.push({ userId: user.id, status: 'error', message: error?.message || 'snapshot logic failed' });
    }
  }

  return results;
}
