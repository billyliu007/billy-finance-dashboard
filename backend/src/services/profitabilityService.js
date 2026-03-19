import { resolveDashboardPayload } from './dashboardService.js';
import { listAllPositionTransactions, listNetWorthHistory } from '../repositories/financeRepository.js';
import { normalizeCurrencyCode } from '../lib/number.js';

function toDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // Expect YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function parseDateUtc(dateOnly) {
  if (!dateOnly) return null;
  const dt = new Date(`${dateOnly}T00:00:00.000Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function diffDays(aDateOnly, bDateOnly) {
  const a = parseDateUtc(aDateOnly);
  const b = parseDateUtc(bDateOnly);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (24 * 3600 * 1000));
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

function resolveNetWorthValue(row, baseCurrency = 'USD') {
  const base = String(baseCurrency || 'USD').trim().toUpperCase();
  const usd = Number(row?.netWorthUsd);
  const cny = Number(row?.netWorthCny);
  if (base === 'CNY') {
    if (Number.isFinite(cny)) return cny;
    if (Number.isFinite(usd)) return usd;
    return null;
  }
  if (Number.isFinite(usd)) return usd;
  if (Number.isFinite(cny)) return cny;
  return null;
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
  // Fallback when conversion is unavailable: keep raw amount to avoid dropping data.
  return amount;
}

function computeTradeAnalytics(transactions, { currencyBySymbol = new Map(), fxRates = {} } = {}) {
  const sells = (transactions || []).filter((tx) => String(tx.type).toUpperCase() === 'SELL');
  const buyFirstDateBySymbol = new Map();
  for (const tx of transactions || []) {
    if (String(tx.type).toUpperCase() !== 'BUY') continue;
    if (!tx.affectsHoldings) continue;
    const sym = String(tx.symbol || '').toUpperCase();
    const d = String(tx.txDate || '');
    if (!sym || !d) continue;
    const existing = buyFirstDateBySymbol.get(sym);
    if (!existing || d < existing) buyFirstDateBySymbol.set(sym, d);
  }

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
      const buyFirst = buyFirstDateBySymbol.get(sym) || null;
      const daysHeld = buyFirst ? diffDays(buyFirst, tx.txDate) : null;
      return {
        id: tx.id,
        symbol: sym,
        txDate: tx.txDate,
        qty,
        sellPricePerUnit: sellPx,
        costBasisPerUnit: basis,
        currency,
        proceeds,
        cost,
        pnl,
        proceedsUsd,
        costUsd,
        pnlUsd,
        returnPct: retPct,
        affectsHoldings: Boolean(tx.affectsHoldings),
        daysHeld,
        notes: tx.notes ?? null,
      };
    })
    .filter((t) => t.qty > 0);

  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWin = wins.length === 0 ? 0 : wins.reduce((acc, t) => acc + t.pnlUsd, 0) / wins.length;
  const avgLoss = losses.length === 0 ? 0 : losses.reduce((acc, t) => acc + t.pnlUsd, 0) / losses.length; // negative
  const grossProfit = wins.reduce((acc, t) => acc + t.pnlUsd, 0);
  const grossLossAbs = losses.reduce((acc, t) => acc + Math.abs(t.pnlUsd), 0);
  const profitFactor = grossLossAbs === 0 ? null : grossProfit / grossLossAbs;

  const bestTrades = [...trades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(0, 10);
  const worstTrades = [...trades].sort((a, b) => a.pnlUsd - b.pnlUsd).slice(0, 10);

  return {
    trades,
    stats: {
      count: trades.length,
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

function bucketizeDays(values) {
  const ranges = [
    { key: '0-7', min: 0, max: 7 },
    { key: '8-30', min: 8, max: 30 },
    { key: '31-90', min: 31, max: 90 },
    { key: '91-180', min: 91, max: 180 },
    { key: '181-365', min: 181, max: 365 },
    { key: '366+', min: 366, max: Infinity },
  ];
  const counts = new Map(ranges.map((r) => [r.key, 0]));
  for (const v of values || []) {
    if (!Number.isFinite(v) || v < 0) continue;
    const range = ranges.find((r) => v >= r.min && v <= r.max);
    if (range) counts.set(range.key, (counts.get(range.key) || 0) + 1);
  }
  return ranges.map((r) => ({ bucket: r.key, count: counts.get(r.key) || 0 }));
}

function computeMonthlySeries({ netWorthSeries, realizedMonthly, baseCurrency = 'USD' }) {
  const monthEnd = new Map();
  for (const p of netWorthSeries || []) {
    const m = monthKey(p.date);
    const val = resolveNetWorthValue(p, baseCurrency);
    if (!m || !Number.isFinite(val)) continue;
    const existing = monthEnd.get(m);
    if (!existing || String(p.date) > existing.date) {
      monthEnd.set(m, { date: p.date, value: val });
    }
  }
  const months = Array.from(new Set([...(realizedMonthly || []).map((r) => r.month), ...monthEnd.keys()])).sort();
  const rows = [];
  let prevMonthVal = null;
  let cumulativeRealized = 0;

  const realizedByMonth = new Map((realizedMonthly || []).map((r) => [r.month, r.realizedPnl]));

  for (const m of months) {
    const end = monthEnd.get(m) || null;
    const endVal = end ? end.value : null;
    const delta = prevMonthVal != null && endVal != null ? endVal - prevMonthVal : null;
    const realized = safeNum(realizedByMonth.get(m));
    const unrealizedEst = delta != null ? delta - realized : null;
    cumulativeRealized += realized;
    rows.push({
      month: m,
      realizedPnl: realized,
      unrealizedPnlEst: unrealizedEst,
      netWorthDelta: delta,
      cumulativeRealized,
    });
    if (endVal != null) prevMonthVal = endVal;
  }
  return rows;
}

function computeAttribution({ portfolioRows }) {
  const bySymbol = [];
  const byAssetClass = new Map();
  const byCurrency = new Map();

  for (const r of portfolioRows || []) {
    const realized = safeNum(r.realizedPnl);
    const unrealized = safeNum(r.pnl);
    const total = realized + unrealized;
    const symbol = String(r.symbol || r.key || '').toUpperCase();
    const category = String(r.category || 'Other');
    const currency = String(r.currency || 'USD').toUpperCase();

    bySymbol.push({
      symbol,
      name: r.name ?? symbol,
      category,
      currency,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      totalPnl: total,
    });

    const cls = byAssetClass.get(category) || { key: category, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0 };
    cls.realizedPnl += realized;
    cls.unrealizedPnl += unrealized;
    cls.totalPnl += total;
    byAssetClass.set(category, cls);

    const cur = byCurrency.get(currency) || { key: currency, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0 };
    cur.realizedPnl += realized;
    cur.unrealizedPnl += unrealized;
    cur.totalPnl += total;
    byCurrency.set(currency, cur);
  }

  const bySymbolSorted = [...bySymbol].sort((a, b) => b.totalPnl - a.totalPnl);
  const topContributors = bySymbolSorted.slice(0, 10);
  const topDetractors = [...bySymbol].sort((a, b) => a.totalPnl - b.totalPnl).slice(0, 10);

  return {
    byAssetClass: Array.from(byAssetClass.values()).sort((a, b) => b.totalPnl - a.totalPnl),
    byCurrency: Array.from(byCurrency.values()).sort((a, b) => b.totalPnl - a.totalPnl),
    topContributors,
    topDetractors,
  };
}

function computeInsights({ attribution, realizedMonthly, totalPnl }) {
  const insights = [];
  const top3 = (attribution?.topContributors || []).slice(0, 3);
  const top3Pnl = top3.reduce((acc, r) => acc + safeNum(r.totalPnl), 0);
  if (Number.isFinite(totalPnl) && Math.abs(totalPnl) > 1e-9 && top3.length > 0) {
    const pct = (top3Pnl / totalPnl) * 100;
    insights.push({
      key: 'concentration',
      message: `Top 3 positions contributed ${pct.toFixed(1)}% of total P/L.`,
    });
  }
  const months = realizedMonthly || [];
  const profitableMonths = months.filter((m) => safeNum(m.realizedPnl) > 0).length;
  if (months.length > 0) {
    insights.push({
      key: 'consistency',
      message: `Profitable realized P/L months: ${profitableMonths} / ${months.length}.`,
    });
  }
  insights.push({
    key: 'suggestions',
    message: 'Consider rebalancing, reducing tail risk, and setting profit-taking rules for outsized winners.',
  });
  return insights;
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
  const byCurrency = new Map();
  for (const row of bySymbol) {
    const cls = byAssetClass.get(row.category) || { key: row.category, realizedPnl: 0 };
    cls.realizedPnl += safeNum(row.realizedPnl);
    byAssetClass.set(row.category, cls);

    const cur = byCurrency.get(row.currency) || { key: row.currency, realizedPnl: 0 };
    cur.realizedPnl += safeNum(row.realizedPnl);
    byCurrency.set(row.currency, cur);
  }

  const contributors = [...bySymbol].sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 10);
  const detractors = [...bySymbol].sort((a, b) => a.realizedPnl - b.realizedPnl).slice(0, 10);

  return {
    byAssetClass: Array.from(byAssetClass.values()).sort((a, b) => b.realizedPnl - a.realizedPnl),
    byCurrency: Array.from(byCurrency.values()).sort((a, b) => b.realizedPnl - a.realizedPnl),
    contributors,
    detractors,
  };
}

/**
 * Build profitability analytics for the Profitability page.
 * @param {string} userId
 * @param {string} baseCurrency
 * @param {{ from?: string|null, to?: string|null }} [range]
 */
export async function resolveProfitabilityPayload(userId, baseCurrency, range = {}) {
  const { from, to } = clampDateRange(range);

  const [dashboard, transactions, netWorthHistory] = await Promise.all([
    resolveDashboardPayload(userId, baseCurrency),
    listAllPositionTransactions(userId, { from, to }),
    listNetWorthHistory(userId),
  ]);

  const portfolioRows = dashboard?.portfolio?.tableRows || [];
  const currencyBySymbol = new Map(
    portfolioRows.map((r) => [
      String(r.symbol || '').toUpperCase(),
      String(r.currency || 'USD').toUpperCase(),
    ]),
  );
  const tradeAnalytics = computeTradeAnalytics(transactions, { currencyBySymbol, fxRates: dashboard?.fxRates || {} });
  const realizedPnl = tradeAnalytics.trades.reduce((acc, t) => acc + safeNum(t.pnlUsd), 0);
  const realizedCost = tradeAnalytics.trades.reduce((acc, t) => acc + safeNum(t.costUsd), 0);

  const unrealizedPnl = safeNum(dashboard?.portfolio?.totals?.pnl);
  const unrealizedCost = safeNum(dashboard?.portfolio?.totals?.cost);
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalCost = unrealizedCost + realizedCost;
  const totalReturnPct = totalCost === 0 ? 0 : (totalPnl / totalCost) * 100;

  // Monthly realized P/L.
  const realizedByMonth = new Map();
  for (const tr of tradeAnalytics.trades) {
    const m = monthKey(tr.txDate);
    if (!m) continue;
    realizedByMonth.set(m, safeNum(realizedByMonth.get(m)) + safeNum(tr.pnlUsd));
  }
  const realizedMonthly = Array.from(realizedByMonth.entries())
    .map(([m, pnl]) => ({ month: m, realizedPnl: pnl }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  // Net worth series filtered to range (for risk metrics and unrealized estimate).
  const filteredNetWorth = (netWorthHistory || []).filter((p) => {
    if (from && String(p.date) < from) return false;
    if (to && String(p.date) > to) return false;
    return true;
  });
  const monthlySeries = computeMonthlySeries({
    netWorthSeries: filteredNetWorth,
    realizedMonthly,
    baseCurrency,
  });
  const attribution = computeAttribution({ portfolioRows });
  const realizedAttribution = computeRealizedAttribution({ trades: tradeAnalytics.trades, portfolioRows });
  const insights = computeInsights({ attribution, realizedMonthly, totalPnl });

  const tradeReturnHistogram = bucketize(
    tradeAnalytics.trades.map((t) => t.returnPct).filter((v) => Number.isFinite(v)),
    { min: -100, max: 200, step: 10 },
  );
  const holdingPeriodHistogram = bucketizeDays(
    tradeAnalytics.trades.map((t) => t.daysHeld).filter((v) => Number.isFinite(v)),
  );

  return {
    range: { from, to },
    summary: {
      totalReturn: { value: totalPnl, pct: totalReturnPct },
      realized: { pnl: realizedPnl },
      unrealized: { pnl: unrealizedPnl },
      realizedVsUnrealized: { realizedPnl, unrealizedPnl, totalPnl },
      winStats: tradeAnalytics.stats,
    },
    timeSeries: {
      realizedMonthly,
      monthlyStacked: monthlySeries, // realized + estimated unrealized (from net worth deltas)
    },
    attribution,
    realizedAttribution,
    trades: {
      best: tradeAnalytics.bestTrades,
      worst: tradeAnalytics.worstTrades,
      all: tradeAnalytics.trades,
      distributions: {
        tradeReturnHistogram,
        holdingPeriodHistogram,
      },
    },
    insights,
  };
}

