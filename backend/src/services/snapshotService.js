import { buildNetWorthPayload } from './netWorthService.js';
import { listCashComponents, listNetWorthHistory, listPortfolioPositions, upsertNetWorthSnapshot } from '../repositories/financeRepository.js';
import { listUsersForSnapshots } from '../repositories/userRepository.js';
import { getCryptoQuoteMapForPositions, getLiveFxRates, getStockQuoteMapForPositions } from './marketDataService.js';

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
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
      const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
        getStockQuoteMapForPositions(positions),
        getCryptoQuoteMapForPositions(positions),
        getLiveFxRates(),
      ]);
      const payload = buildNetWorthPayload({
        cashComponents,
        positions,
        history,
        stockQuotes,
        cryptoQuotes,
        fxRatesOverride: fxRates,
      });
      await upsertNetWorthSnapshot({
        userId: user.id,
        dateUtc,
        totalCny: payload.overview.totalNetWorth,
        qualityStatus: payload.overview.missingInputs.length > 0 ? 'partial' : 'full',
      });
      results.push({ userId: user.id, status: 'ok' });
    } catch (error) {
      results.push({ userId: user.id, status: 'error', message: error?.message || 'snapshot failed' });
    }
  }
  return results;
}
