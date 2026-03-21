import { loadTradingPerformanceHoldingsSlice } from './dashboardService.js';
import { listAllPositionTransactions } from '../repositories/financeRepository.js';
import { normalizeCurrencyCode } from '../lib/number.js';

function toDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampDateRange({ from, to }) {
  const f = toDateOnly(from);
  const t = toDateOnly(to);
  if (f && t && f > t) {
    return { from: t, to: f };
  }
  return { from: f, to: t };
}

function monthKey(dateOnly) {
  return String(dateOnly || '').slice(0, 7); // YYYY-MM
}

/**
 * Cumulative realized P/L by month.
 * @param {{ month: string, realizedPnl: number }[]} realizedMonthly - sorted ascending by month
 */
function buildMonthlyStackedFromRealized(realizedMonthly) {
  let cumulativeRealized = 0;
  return (realizedMonthly || []).map(({ month, realizedPnl }) => {
    const realized = safeNum(realizedPnl);
    cumulativeRealized += realized;
    return {
      month,
      realizedPnl: realized,
      cumulativeRealized,
    };
  });
}

function toUsdAmount(value, currency, fxRates = {}) {
  const amount = safeNum(value);
  const cur = normalizeCurrencyCode(currency || 'USD');
  if (cur === 'USD') return amount;
  const usdToCny = safeNum(fxRates?.USD);
  const curToCny = safeNum(fxRates?.[cur]);
  if (usdToCny > 0 && curToCny > 0) {
    return (amount * curToCny) / usdToCny;
  }
  return amount;
}

/** @typedef {{ id: any, txDate: string, symbol: string, qty: number, proceeds: number, cost: number, pnl: number, currency: string, returnPct: number|null, pnlUsd: number, proceedsUsd: number, costUsd: number }} TradeRow */

function computeTradeAnalytics(transactions, { currencyBySymbol = new Map(), fxRates = {} } = {}) {
  const sells = (transactions || []).filter((tx) => String(tx.type).toUpperCase() === 'SELL');

  /** @type {TradeRow[]} */
  const trades = sells
    .map((tx) => {
      const qty = safeNum(tx.qty);
      const sellPx = safeNum(tx.avgCostPerUnit);
      const basis = safeNum(tx.costBasisPerUnit);
      const feeTotal = safeNum(tx.feeFlat);
      const proceeds = qty * sellPx - feeTotal;
      const cost = qty * basis;
      const pnl = proceeds - cost;
      const retPct = cost > 0 ? (pnl / cost) * 100 : null;
      const sym = String(tx.symbol || '').toUpperCase();
      const currency = currencyBySymbol.get(sym) || 'USD';
      const proceedsUsd = toUsdAmount(proceeds, currency, fxRates);
      const costUsd = toUsdAmount(cost, currency, fxRates);
      const pnlUsd = proceedsUsd - costUsd;
      return {
        id: tx.id,
        symbol: sym,
        txDate: tx.txDate,
        qty,
        proceeds,
        cost,
        pnl,
        proceedsUsd,
        costUsd,
        pnlUsd,
        currency,
        returnPct: retPct,
      };
    })
    .filter((t) => t.qty > 0);

  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWin = wins.length === 0 ? 0 : wins.reduce((acc, t) => acc + t.pnlUsd, 0) / wins.length;
  const avgLoss = losses.length === 0 ? 0 : losses.reduce((acc, t) => acc + t.pnlUsd, 0) / losses.length;
  const grossProfit = wins.reduce((acc, t) => acc + t.pnlUsd, 0);
  const grossLossAbs = losses.reduce((acc, t) => acc + Math.abs(t.pnlUsd), 0);
  const profitFactor = grossLossAbs === 0 ? null : grossProfit / grossLossAbs;

  const bestTrades = [...trades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(0, 10);
  const worstTrades = [...trades].sort((a, b) => a.pnlUsd - b.pnlUsd).slice(0, 10);

  return {
    trades,
    stats: {
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
    },
    bestTrades,
    worstTrades,
  };
}

function bucketize(values, { min = -100, max = 100, step = 10 } = {}) {
  const buckets = [];
  for (let start = min; start < max; start += step) {
    buckets.push({ start, end: start + step, count: 0 });
  }
  for (const v of values || []) {
    if (!Number.isFinite(v)) continue;
    const clamped = Math.min(max - 1e-9, Math.max(min, v));
    const idx = Math.floor((clamped - min) / step);
    if (buckets[idx]) buckets[idx].count += 1;
  }
  return buckets.map((b) => ({
    bucket: `${b.start}–${b.end}%`,
    start: b.start,
    end: b.end,
    count: b.count,
  }));
}

function computeRealizedAttribution({ trades, portfolioRows }) {
  const metaBySymbol = new Map(
    (portfolioRows || []).map((r) => [
      String(r.symbol || r.key || '').toUpperCase(),
      {
        symbol: String(r.symbol || r.key || '').toUpperCase(),
        name: r.name ?? String(r.symbol || r.key || '').toUpperCase(),
        category: String(r.category || 'Other'),
        currency: String(r.currency || 'USD').toUpperCase(),
      },
    ]),
  );

  const realizedBySymbol = new Map();
  for (const tr of trades || []) {
    const sym = String(tr.symbol || '').toUpperCase();
    if (!sym) continue;
    realizedBySymbol.set(sym, safeNum(realizedBySymbol.get(sym)) + safeNum(tr.pnlUsd));
  }

  const bySymbol = Array.from(realizedBySymbol.entries()).map(([symbol, realizedPnl]) => {
    const meta = metaBySymbol.get(symbol) || {
      symbol,
      name: symbol,
      category: 'Other',
      currency: 'USD',
    };
    return {
      symbol,
      name: meta.name,
      category: meta.category,
      currency: meta.currency,
      realizedPnl,
    };
  });

  const byAssetClass = new Map();
  for (const row of bySymbol) {
    const cls = byAssetClass.get(row.category) || { key: row.category, realizedPnl: 0 };
    cls.realizedPnl += safeNum(row.realizedPnl);
    byAssetClass.set(row.category, cls);
  }

  const contributors = [...bySymbol].sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 10);
  const detractors = [...bySymbol].sort((a, b) => a.realizedPnl - b.realizedPnl).slice(0, 10);

  return {
    byAssetClass: Array.from(byAssetClass.values()).sort((a, b) => b.realizedPnl - a.realizedPnl),
    contributors,
    detractors,
  };
}

/**
 * Trading-performance JSON for the page + AI prompt. Aggregates are USD-normalized (`pnlUsd`).
 * @param {string} userId
 * @param {{ from?: string|null, to?: string|null }} [range]
 */
export async function resolveProfitabilityPayload(userId, range = {}) {
  const { from, to } = clampDateRange(range);

  const [holdings, transactions] = await Promise.all([
    loadTradingPerformanceHoldingsSlice(userId),
    listAllPositionTransactions(userId, { from, to }),
  ]);

  const portfolioRows = holdings?.tableRows || [];
  const currencyBySymbol = new Map(
    portfolioRows.map((r) => [
      String(r.symbol || '').toUpperCase(),
      String(r.currency || 'USD').toUpperCase(),
    ]),
  );
  const tradeAnalytics = computeTradeAnalytics(transactions, { currencyBySymbol, fxRates: {} });
  const realizedPnl = tradeAnalytics.trades.reduce((acc, t) => acc + safeNum(t.pnlUsd), 0);
  const realizedCost = tradeAnalytics.trades.reduce((acc, t) => acc + safeNum(t.costUsd), 0);

  const realizedByMonth = new Map();
  for (const tr of tradeAnalytics.trades) {
    const m = monthKey(tr.txDate);
    if (!m) continue;
    realizedByMonth.set(m, safeNum(realizedByMonth.get(m)) + safeNum(tr.pnlUsd));
  }
  const realizedMonthly = Array.from(realizedByMonth.entries())
    .map(([m, pnl]) => ({ month: m, realizedPnl: pnl }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const monthlyStacked = buildMonthlyStackedFromRealized(realizedMonthly);
  const realizedAttribution = computeRealizedAttribution({ trades: tradeAnalytics.trades, portfolioRows });

  const tradeReturnHistogram = bucketize(
    tradeAnalytics.trades.map((t) => t.returnPct).filter((v) => Number.isFinite(v)),
    { min: -100, max: 200, step: 10 },
  );

  const tradeWire = (t) => ({
    id: t.id,
    txDate: t.txDate,
    symbol: t.symbol,
    qty: t.qty,
    proceeds: t.proceeds,
    cost: t.cost,
    pnl: t.pnl,
    currency: t.currency,
    returnPct: t.returnPct,
    pnlUsd: t.pnlUsd,
  });

  return {
    portfolioIsEmpty: Boolean(holdings?.isEmpty),
    range: { from, to },
    summary: {
      realized: { pnl: realizedPnl, pct: realizedCost === 0 ? 0 : (realizedPnl / realizedCost) * 100 },
      winStats: tradeAnalytics.stats,
    },
    timeSeries: {
      monthlyStacked,
    },
    realizedAttribution,
    trades: {
      best: tradeAnalytics.bestTrades.map(tradeWire),
      worst: tradeAnalytics.worstTrades.map(tradeWire),
      distributions: {
        tradeReturnHistogram,
      },
    },
  };
}
