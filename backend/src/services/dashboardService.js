/**
 * Assembles the full dashboard payload (net worth + portfolio) for a user.
 */

import { buildNetWorthPayload } from './netWorthService.js';
import { buildPortfolioPayload } from './portfolioService.js';
import {
  getCryptoQuoteMapForPositions,
  getLiveFxRates,
  getStockQuoteMapForPositions,
} from './marketDataService.js';
import {
  listCashComponents,
  listNetWorthHistory,
  listPortfolioPositions,
} from '../repositories/financeRepository.js';

/**
 * Load all data required for the dashboard and return net worth, portfolio, fx rates, and raw positions.
 * @param {string} userId
 * @param {string} [baseCurrency='USD'] - User's preferred base currency for net worth display
 * @returns {Promise<{ netWorth: object, portfolio: object, fxRates: object, positions: object[] }>}
 */
export async function resolveDashboardPayload(userId, baseCurrency = 'USD') {
  const base = String(baseCurrency || 'USD').trim().toUpperCase() || 'USD';

  const [cashComponents, positions, history] = await Promise.all([
    listCashComponents(userId),
    listPortfolioPositions(userId),
    listNetWorthHistory(userId),
  ]);

  const currenciesFromCash = [
    ...new Set((cashComponents || []).map((c) => String(c?.currency || '').toUpperCase()).filter(Boolean)),
  ];
  if (base !== 'CNY') {
    currenciesFromCash.push(base);
  }

  const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
    getStockQuoteMapForPositions(positions),
    getCryptoQuoteMapForPositions(positions),
    getLiveFxRates(currenciesFromCash),
  ]);

  const netWorth = buildNetWorthPayload({
    cashComponents,
    positions,
    history,
    stockQuotes,
    cryptoQuotes,
    fxRatesOverride: fxRates,
    baseCurrency: base,
  });
  netWorth.overview.cashComponents = cashComponents;
  netWorth.overview.baseCurrency = base;

  const portfolio = buildPortfolioPayload({
    positions,
    stockQuotes,
    cryptoQuotes,
  });

  return { netWorth, portfolio, fxRates, positions };
}
