import { resolveDashboardPayload } from './dashboardService.js';
import { listAllPositionTransactions, listNetWorthHistory } from '../repositories/financeRepository.js';

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

function computeTradeAnalytics(transactions) {
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
      const proceeds = qty * sellPx;
      const cost = qty * basis;
      const pnl = proceeds - cost;
      const retPct = cost > 0 ? (pnl / cost) * 100 : null;
      const sym = String(tx.symbol || '').toUpperCase();
      const buyFirst = buyFirstDateBySymbol.get(sym) || null;
      const daysHeld = buyFirst ? diffDays(buyFirst, tx.txDate) : null;
      return {
        id: tx.id,
        symbol: sym,
        txDate: tx.txDate,
        qty,
        sellPricePerUnit: sellPx,
        costBasisPerUnit: basis,
        proceeds,
        cost,
        pnl,
        returnPct: retPct,
        affectsHoldings: Boolean(tx.affectsHoldings),
        daysHeld,
        notes: tx.notes ?? null,
      };
    })
    .filter((t) => t.qty > 0);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWin = wins.length === 0 ? 0 : wins.reduce((acc, t) => acc + t.pnl, 0) / wins.length;
  const avgLoss = losses.length === 0 ? 0 : losses.reduce((acc, t) => acc + t.pnl, 0) / losses.length; // negative
  const grossProfit = wins.reduce((acc, t) => acc + t.pnl, 0);
  const grossLossAbs = losses.reduce((acc, t) => acc + Math.abs(t.pnl), 0);
  const profitFactor = grossLossAbs === 0 ? null : grossProfit / grossLossAbs;

  const bestTrades = [...trades].sort((a, b) => b.pnl - a.pnl).slice(0, 10);
  const worstTrades = [...trades].sort((a, b) => a.pnl - b.pnl).slice(0, 10);

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

function computeDrawdownAndRisk(netWorthSeries) {
  const points = (netWorthSeries || [])
    .map((p) => ({
      date: p.date,
      value: Number.isFinite(Number(p.netWorthUsd)) ? Number(p.netWorthUsd) : Number(p.netWorthCny),
    }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0 && p.date);

  if (points.length < 2) {
    return { maxDrawdownPct: null, volatilityAnnualized: null, sharpe: null };
  }

  let peak = points[0].value;
  let maxDd = 0;
  for (const p of points) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? (p.value - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }

  const returns = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    if (prev > 0 && Number.isFinite(cur)) {
      returns.push(cur / prev - 1);
    }
  }

  if (returns.length < 2) {
    return { maxDrawdownPct: maxDd * 100, volatilityAnnualized: null, sharpe: null };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(Math.max(0, variance));
  const volAnnual = std * Math.sqrt(252);
  const sharpe = std === 0 ? null : (mean / std) * Math.sqrt(252);

  return {
    maxDrawdownPct: maxDd * 100,
    volatilityAnnualized: volAnnual * 100,
    sharpe,
  };
}

function computeMonthlySeries({ netWorthSeries, realizedMonthly }) {
  const monthEnd = new Map();
  for (const p of netWorthSeries || []) {
    const m = monthKey(p.date);
    const val = Number.isFinite(Number(p.netWorthUsd)) ? Number(p.netWorthUsd) : Number(p.netWorthCny);
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

  const tradeAnalytics = computeTradeAnalytics(transactions);
  const realizedPnl = tradeAnalytics.trades.reduce((acc, t) => acc + safeNum(t.pnl), 0);
  const realizedCost = tradeAnalytics.trades.reduce((acc, t) => acc + safeNum(t.cost), 0);

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
    realizedByMonth.set(m, safeNum(realizedByMonth.get(m)) + safeNum(tr.pnl));
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
  const risk = computeDrawdownAndRisk(filteredNetWorth);

  const monthlySeries = computeMonthlySeries({ netWorthSeries: filteredNetWorth, realizedMonthly });
  const attribution = computeAttribution({ portfolioRows: dashboard?.portfolio?.tableRows || [] });
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
      risk,
    },
    benchmarks: dashboard?.benchmarks ?? null,
    timeSeries: {
      realizedMonthly,
      monthlyStacked: monthlySeries, // realized + estimated unrealized (from net worth deltas)
    },
    attribution,
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

