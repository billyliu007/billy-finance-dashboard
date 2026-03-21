/**
 * Dashboard: net worth + portfolio. Trading performance uses `loadTradingPerformanceHoldingsSlice`
 * (DB-only metadata; same visibility as portfolio, no live quotes).
 */

import { buildNetWorthPayload } from './netWorthService.js';
import { buildPortfolioPayload, buildTradingPerformanceHoldingsSlice } from './portfolioService.js';
import {
  getBenchmarkQuotes,
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
 * Merge raw positions with transaction aggregate rows (same shape as dashboard positions).
 * @param {object[]} positions
 * @param {object[]} txAggRows
 * @returns {object[]}
 */
export function applyTransactionAggregatesToPositions(positions, txAggRows) {
  const txAggBySymbol = new Map(
    (txAggRows || []).map((r) => [
      String(r.symbol || '').toUpperCase(),
      {
        buyQty: Number(r.buyQty) || 0,
        buyCost: Number(r.buyCost) || 0,
        holdingSellQty: Number(r.holdingSellQty) || 0,
        holdingSellProceeds: Number(r.holdingSellProceeds) || 0,
        holdingSellCost: Number(r.holdingSellCost) || 0,
        realizedSellQty: Number(r.realizedSellQty) || 0,
        realizedSellProceeds: Number(r.realizedSellProceeds) || 0,
        realizedSellCost: Number(r.realizedSellCost) || 0,
      },
    ]),
  );
  return (positions || []).map((p) => {
    const sym = String(p.symbol || '').toUpperCase();
    const tx = txAggBySymbol.get(sym) || {
      buyQty: 0,
      buyCost: 0,
      holdingSellQty: 0,
      holdingSellProceeds: 0,
      holdingSellCost: 0,
      realizedSellQty: 0,
      realizedSellProceeds: 0,
      realizedSellCost: 0,
    };
    const baseQty = Number(p.qty) || 0;
    const baseAvg = Number(p.purchasePrice) || 0;
    const baseCost = baseQty * baseAvg;
    const buyQty = Number(tx.buyQty) || 0;
    const buyCost = Number(tx.buyCost) || 0;
    const holdingSellQty = Number(tx.holdingSellQty) || 0;
    const holdingSellProceeds = Number(tx.holdingSellProceeds) || 0;
    const holdingSellCost = Number(tx.holdingSellCost) || 0;
    const realizedSellQty = Number(tx.realizedSellQty) || 0;
    const realizedSellProceeds = Number(tx.realizedSellProceeds) || 0;
    const realizedSellCost = Number(tx.realizedSellCost) || 0;
    const totalQty = baseQty + buyQty - holdingSellQty;
    const totalCost = baseCost + buyCost - holdingSellCost;
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
    const realizedPnl = realizedSellProceeds - realizedSellCost;
    return {
      ...p,
      baseQty,
      baseAvgCost: baseAvg,
      baseCost,
      buyQty,
      buyCost,
      sellQty: holdingSellQty,
      sellProceeds: realizedSellProceeds,
      sellCost: realizedSellCost,
      holdingSellQty,
      holdingSellProceeds,
      holdingSellCost,
      realizedSellQty,
      realizedSellProceeds,
      realizedSellCost,
      realizedPnl,
      totalQty,
      totalCost,
      totalAvgCost: avgCost,
      qty: totalQty,
      purchasePrice: avgCost,
    };
  });
}

/**
 * DB-only holdings metadata for **trading performance** (symbol → currency / attribution labels).
 * Same visibility rules as the portfolio page; no live quotes.
 * @param {string} userId
 * @returns {Promise<{ isEmpty: boolean, tableRows: object[] }>}
 */
export async function loadTradingPerformanceHoldingsSlice(userId) {
  const [positions, txAggRows] = await Promise.all([
    listPortfolioPositions(userId),
    listPositionTransactionAggregates(userId),
  ]);
  const effectivePositions = applyTransactionAggregatesToPositions(positions, txAggRows);
  return buildTradingPerformanceHoldingsSlice({ positions: effectivePositions });
}

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

  const effectivePositions = applyTransactionAggregatesToPositions(positions, txAggRows);

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

  const benchmarks = await getBenchmarkQuotes();

  return { netWorth, portfolio, fxRates, positions: effectivePositions, benchmarks };
}
