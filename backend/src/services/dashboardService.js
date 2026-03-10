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

const DATA_SOURCE = String(process.env.DATA_SOURCE || 'db').trim().toLowerCase();

/**
 * Load all data required for the dashboard and return net worth, portfolio, fx rates, and raw positions.
 * @param {string} userId
 * @returns {Promise<{ netWorth: object, portfolio: object, fxRates: object, positions: object[] }>}
 */
export async function resolveDashboardPayload(userId) {
  if (DATA_SOURCE !== 'db' && DATA_SOURCE !== 'hybrid') {
    throw new Error(`Unsupported DATA_SOURCE value: ${DATA_SOURCE}. Expected db or hybrid.`);
  }

  const [cashComponents, positions, history] = await Promise.all([
    listCashComponents(userId),
    listPortfolioPositions(userId),
    listNetWorthHistory(userId),
  ]);

  const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
    getStockQuoteMapForPositions(positions),
    getCryptoQuoteMapForPositions(positions),
    getLiveFxRates(),
  ]);

  const netWorth = buildNetWorthPayload({
    cashComponents,
    positions,
    history,
    stockQuotes,
    cryptoQuotes,
    fxRatesOverride: fxRates,
  });

  const portfolio = buildPortfolioPayload({
    positions,
    stockQuotes,
    cryptoQuotes,
  });

  return { netWorth, portfolio, fxRates, positions };
}
