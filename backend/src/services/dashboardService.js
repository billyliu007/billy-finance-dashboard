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
  listPositionTransactionAggregates,
} from '../repositories/financeRepository.js';

/**
 * Load all data required for the dashboard and return net worth, portfolio, fx rates, and raw positions.
 * @param {string} userId
 * @param {string} [baseCurrency='USD'] - User's preferred base currency for net worth display
 * @returns {Promise<{ netWorth: object, portfolio: object, fxRates: object, positions: object[] }>}
 */
export async function resolveDashboardPayload(userId, baseCurrency = 'USD') {
  const base = String(baseCurrency || 'USD').trim().toUpperCase() || 'USD';

  const [cashComponents, positions, history, txAggRows] = await Promise.all([
    listCashComponents(userId),
    listPortfolioPositions(userId),
    listNetWorthHistory(userId),
    listPositionTransactionAggregates(userId),
  ]);

  const txAggBySymbol = new Map(
    (txAggRows || []).map((r) => [String(r.symbol || '').toUpperCase(), { txQty: Number(r.txQty) || 0, txCost: Number(r.txCost) || 0 }]),
  );
  const effectivePositions = (positions || []).map((p) => {
    const sym = String(p.symbol || '').toUpperCase();
    const tx = txAggBySymbol.get(sym) || { txQty: 0, txCost: 0 };
    const baseQty = Number(p.qty) || 0;
    const baseAvg = Number(p.purchasePrice) || 0;
    const baseCost = baseQty * baseAvg;
    const totalQty = baseQty + (Number(tx.txQty) || 0);
    const totalCost = baseCost + (Number(tx.txCost) || 0);
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
    return {
      ...p,
      baseQty,
      baseAvgCost: baseAvg,
      baseCost,
      txQty: Number(tx.txQty) || 0,
      txCost: Number(tx.txCost) || 0,
      totalQty,
      totalCost,
      totalAvgCost: avgCost,
      qty: totalQty,
      purchasePrice: avgCost,
    };
  });

  const currenciesFromCash = [
    ...new Set((cashComponents || []).map((c) => String(c?.currency || '').toUpperCase()).filter(Boolean)),
  ];
  if (base !== 'CNY') {
    currenciesFromCash.push(base);
  }

  const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
    getStockQuoteMapForPositions(effectivePositions),
    getCryptoQuoteMapForPositions(effectivePositions),
    getLiveFxRates(currenciesFromCash),
  ]);

  const netWorth = buildNetWorthPayload({
    cashComponents,
    positions: effectivePositions,
    history,
    stockQuotes,
    cryptoQuotes,
    fxRatesOverride: fxRates,
    baseCurrency: base,
  });
  netWorth.overview.cashComponents = cashComponents;
  netWorth.overview.baseCurrency = base;

  const portfolio = buildPortfolioPayload({
    positions: effectivePositions,
    stockQuotes,
    cryptoQuotes,
  });

  return { netWorth, portfolio, fxRates, positions: effectivePositions };
}
