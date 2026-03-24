import { resolveDashboardPayload } from './dashboardService.js';
import { stockProviders, cryptoProviders } from '../lib/marketDataProviders.js';
import {
  getWhatIfScenarioById,
  listWhatIfTargetPrices,
  listWhatIfHypotheticalPurchases,
} from '../repositories/whatIfScenarioRepository.js';

function toUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function isStockLike(category) {
  return /stock/i.test(String(category || ''));
}

function isCryptoLike(category) {
  return /crypto/i.test(String(category || ''));
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function fetchMarketPriceCandidates(symbol) {
  const stockProvider = stockProviders.finnhub;
  if (stockProvider) {
    const stock = await stockProvider.getQuotes([{ assetSymbol: symbol, providerSymbol: symbol }]);
    const stockPrice = Number(stock?.[symbol]?.price);
    if (Number.isFinite(stockPrice) && stockPrice > 0) {
      return { price: stockPrice, source: 'market-stock' };
    }
  }

  const coinbase = cryptoProviders.coinbase;
  if (coinbase) {
    for (const providerSymbol of [`${symbol}-USD`, `${symbol}-USDT`, `${symbol}-USDC`]) {
      const crypto = await coinbase.getQuotes([{ assetSymbol: symbol, providerSymbol }]);
      const price = Number(crypto?.[symbol]?.price);
      if (Number.isFinite(price) && price > 0) {
        return { price, source: 'market-crypto' };
      }
    }
  }
  return null;
}

export function computeWhatIfFromData({
  scenario,
  targetPrices,
  hypotheticalPurchases,
  baselineRows,
  baselineTotalValue,
  baselineTotalCost,
  baseCurrency = 'USD',
  fxRates = {},
  fetchedPriceMap = new Map(),
}) {
  const targetMap = new Map(targetPrices.map((row) => [toUpper(row.symbol), row]));

  const rowsBySymbol = new Map(
    baselineRows.map((row) => [
      toUpper(row.symbol),
      {
        symbol: toUpper(row.symbol),
        name: row.name || toUpper(row.symbol),
        category: row.category || 'Other',
        currency: toUpper(row.currency || 'USD') || 'USD',
        baselineQty: numberOrZero(row.qty),
        scenarioQty: numberOrZero(row.qty),
        baselineAvgCost: numberOrZero(row.purchasePrice),
        scenarioAvgCost: numberOrZero(row.purchasePrice),
        baselineCostBasis: numberOrZero(row.totalPurchaseCost),
        scenarioCostBasis: numberOrZero(row.totalPurchaseCost),
        baselinePrice: numberOrZero(row.currentPrice),
      },
    ]),
  );

  for (const buy of hypotheticalPurchases) {
    const symbol = toUpper(buy.symbol);
    const qty = numberOrZero(buy.qty);
    const buyPrice = numberOrZero(buy.buyPrice);
    if (qty <= 0) continue;
    const existing = rowsBySymbol.get(symbol);
    if (existing) {
      const addedCost = qty * buyPrice;
      const nextQty = existing.scenarioQty + qty;
      const nextCost = existing.scenarioCostBasis + addedCost;
      existing.scenarioQty = nextQty;
      existing.scenarioCostBasis = nextCost;
      existing.scenarioAvgCost = nextQty > 0 ? nextCost / nextQty : 0;
      existing.currency = toUpper(buy.currency || existing.currency || 'USD') || 'USD';
      continue;
    }
    rowsBySymbol.set(symbol, {
      symbol,
      name: symbol,
      category: 'US Stock Assets',
      currency: toUpper(buy.currency || 'USD') || 'USD',
      baselineQty: 0,
      scenarioQty: qty,
      baselineAvgCost: 0,
      scenarioAvgCost: buyPrice,
      baselineCostBasis: 0,
      scenarioCostBasis: qty * buyPrice,
      baselinePrice: 0,
    });
  }

  const symbolsMissingBaselinePrice = Array.from(rowsBySymbol.values())
    .filter((row) => row.baselinePrice <= 0 && !fetchedPriceMap.has(row.symbol))
    .map((row) => row.symbol);
  if (symbolsMissingBaselinePrice.length > 0) {
    // caller should pre-fill fetched prices for symbols with no baseline; keep fallback behavior deterministic.
  }

  const scenarioRows = Array.from(rowsBySymbol.values()).map((row) => {
    const override = targetMap.get(row.symbol);
    const overridePrice = numberOrZero(override?.targetPrice);
    const fetched = fetchedPriceMap.get(row.symbol);
    const marketPrice = row.baselinePrice > 0 ? row.baselinePrice : numberOrZero(fetched?.price);
    const marketSource = row.baselinePrice > 0 ? 'dashboard' : fetched?.source || 'none';
    const scenarioPrice = overridePrice > 0 ? overridePrice : marketPrice > 0 ? marketPrice : row.scenarioAvgCost;
    const scenarioSource = overridePrice > 0 ? 'target-price' : marketPrice > 0 ? marketSource : 'buy-price-fallback';
    const baselineValue = row.baselineQty * marketPrice;
    const scenarioValue = row.scenarioQty * scenarioPrice;
    const pnl = scenarioValue - row.scenarioCostBasis;
    return {
      symbol: row.symbol,
      name: row.name,
      category: row.category,
      currency: row.currency,
      qty: row.scenarioQty,
      avgCost: row.scenarioAvgCost,
      costBasis: row.scenarioCostBasis,
      baselineQty: row.baselineQty,
      baselineCostBasis: row.baselineCostBasis,
      baselineValue,
      baselinePrice: marketPrice,
      scenarioPrice,
      scenarioPriceSource: scenarioSource,
      scenarioValue,
      pnl,
    };
  });

  const scenarioTotals = scenarioRows.reduce(
    (acc, row) => {
      acc.value += numberOrZero(row.scenarioValue);
      acc.cost += numberOrZero(row.scenarioCostBasis ?? row.costBasis);
      acc.pnl += numberOrZero(row.pnl);
      return acc;
    },
    { value: 0, cost: 0, pnl: 0 },
  );

  const base = toUpper(baseCurrency || 'USD') || 'USD';
  const resolvedFxRates = {
    USD: 1,
    ...Object.entries(fxRates || {}).reduce((acc, [currency, rate]) => {
      const parsed = Number(rate);
      if (Number.isFinite(parsed) && parsed > 0) {
        acc[toUpper(currency)] = parsed;
      }
      return acc;
    }, {}),
  };
  const usdPerBase = Number(resolvedFxRates[base]);
  const basePerUsd = base === 'USD' ? 1 : Number.isFinite(usdPerBase) && usdPerBase > 0 ? 1 / usdPerBase : null;
  const usdPerUnitForCurrency = (currencyCode) => {
    const cur = toUpper(currencyCode || 'USD') || 'USD';
    if (cur === 'USD' || cur === 'USDT' || cur === 'USDC') return 1;
    const rate = Number(resolvedFxRates[cur]);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  };
  const toBaseValue = (localValue, currencyCode) => {
    if (!Number.isFinite(localValue) || basePerUsd == null) return null;
    const usdPerUnit = usdPerUnitForCurrency(currencyCode);
    if (usdPerUnit == null) return null;
    return localValue * usdPerUnit * basePerUsd;
  };
  const portfolioBaseTotals = scenarioRows.reduce(
    (acc, row) => {
      const baselineValueLocal = numberOrZero(row.baselineValue);
      const baselineValueBase = toBaseValue(baselineValueLocal, row.currency);
      const scenarioValueBase = toBaseValue(numberOrZero(row.scenarioValue), row.currency);
      if (baselineValueBase != null) acc.baselineValue += baselineValueBase;
      else acc.missingCount += 1;
      if (scenarioValueBase != null) acc.scenarioValue += scenarioValueBase;
      else acc.missingCount += 1;
      return acc;
    },
    { baseCurrency: base, baselineValue: 0, scenarioValue: 0, missingCount: 0 },
  );
  portfolioBaseTotals.deltaValue = portfolioBaseTotals.scenarioValue - portfolioBaseTotals.baselineValue;
  portfolioBaseTotals.hypotheticalCostBase = (hypotheticalPurchases || []).reduce((sum, item) => {
    const qty = numberOrZero(item?.qty);
    const buyPrice = numberOrZero(item?.buyPrice);
    const currency = toUpper(item?.currency || 'USD');
    const costBase = toBaseValue(qty * buyPrice, currency);
    return sum + (costBase == null ? 0 : costBase);
  }, 0);

  const enrichedRows = scenarioRows.map((row) => ({
    ...row,
    baselineWeightPct: baselineTotalValue > 0 ? (numberOrZero(row.baselineValue) / baselineTotalValue) * 100 : 0,
    scenarioWeightPct: scenarioTotals.value > 0 ? (numberOrZero(row.scenarioValue) / scenarioTotals.value) * 100 : 0,
  }));

  return {
    scenario: {
      id: scenario.id,
      name: scenario.name,
      isActive: Boolean(scenario.isActive),
    },
    baseline: {
      totalValue: baselineTotalValue,
      totalCost: baselineTotalCost,
    },
    scenarioTotals,
    portfolioBaseTotals,
    targetPrices,
    hypotheticalPurchases,
    rows: enrichedRows.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

export async function computeWhatIfScenarioResults({ userId, scenarioId, baseCurrency = 'USD' }) {
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');

  const [targetPrices, hypotheticalPurchases, dashboard] = await Promise.all([
    listWhatIfTargetPrices({ userId, scenarioId }),
    listWhatIfHypotheticalPurchases({ userId, scenarioId }),
    resolveDashboardPayload(userId, baseCurrency),
  ]);

  const baselineRows = Array.isArray(dashboard?.portfolio?.tableRows) ? dashboard.portfolio.tableRows : [];
  const baselineTotalValue = numberOrZero(dashboard?.portfolio?.totals?.value);
  const baselineTotalCost = numberOrZero(dashboard?.portfolio?.totals?.cost);
  const symbolsMissingBaselinePrice = [
    ...new Set([
      ...baselineRows.filter((row) => numberOrZero(row.currentPrice) <= 0).map((row) => toUpper(row.symbol)),
      ...hypotheticalPurchases.map((row) => toUpper(row.symbol)),
    ]),
  ].filter(Boolean);
  const fetchedPriceMap = new Map();
  await Promise.all(
    symbolsMissingBaselinePrice.map(async (symbol) => {
      const fetched = await fetchMarketPriceCandidates(symbol);
      if (fetched) fetchedPriceMap.set(symbol, fetched);
    }),
  );

  return computeWhatIfFromData({
    scenario,
    targetPrices,
    hypotheticalPurchases,
    baselineRows,
    baselineTotalValue,
    baselineTotalCost,
    baseCurrency,
    fxRates: dashboard?.fxRates || {},
    fetchedPriceMap,
  });
}
