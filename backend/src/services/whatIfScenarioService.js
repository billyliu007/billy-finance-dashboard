import { applyTransactionAggregatesToPositions } from './dashboardService.js';
import { buildPortfolioPayload } from './portfolioService.js';
import { getCryptoQuoteMapForPositions, getStockQuoteMapForPositions, resolveLiveFxRates } from './marketDataService.js';
import { getCryptoQuotes, getStockQuotes } from './pricingGateway.js';
import {
  getWhatIfScenarioById,
  listWhatIfTargetPrices,
  listWhatIfHypotheticalPurchases,
  listWhatIfHypotheticalSales,
} from '../repositories/whatIfScenarioRepository.js';
import { listPortfolioPositions, listPositionTransactionAggregates } from '../repositories/financeRepository.js';

const WHATIF_RESULTS_CACHE_TTL_MS = 15000;
const whatIfResultsCache = new Map();
const WHATIF_TIMING_LOG = ['1', 'true', 'yes', 'on'].includes(String(process.env.WHATIF_TIMING_LOG || '').trim().toLowerCase());

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function logTiming(meta, steps) {
  if (!WHATIF_TIMING_LOG) return;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        tag: 'whatif_timing',
        at: new Date().toISOString(),
        ...meta,
        steps,
      },
      null,
      0,
    ),
  );
}

function cacheGet(key) {
  const hit = whatIfResultsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    whatIfResultsCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  whatIfResultsCache.set(key, { value, expiresAt: Date.now() + WHATIF_RESULTS_CACHE_TTL_MS });
}

function stableInputsHash({ targetPrices = [], hypotheticalPurchases = [], hypotheticalSales = [] }) {
  const targets = (targetPrices || [])
    .map((r) => ({
      symbol: toUpper(r?.symbol),
      targetPrice: numberOrZero(r?.targetPrice),
      targetPrice2: numberOrZero(r?.targetPrice2),
      currency: toUpper(r?.currency || '') || null,
    }))
    .filter((r) => r.symbol && (r.targetPrice > 0 || r.targetPrice2 > 0))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const buys = (hypotheticalPurchases || [])
    .map((r) => ({
      symbol: toUpper(r?.symbol),
      qty: numberOrZero(r?.qty),
      buyPrice: numberOrZero(r?.buyPrice),
      currency: toUpper(r?.currency || '') || null,
      comment: String(r?.comment ?? '').trim(),
    }))
    .filter((r) => r.symbol && r.qty > 0 && r.buyPrice >= 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Order matters for sales (cumulative qty cap); preserve array order.
  const sales = (hypotheticalSales || [])
    .map((r) => ({
      symbol: toUpper(r?.symbol),
      qty: numberOrZero(r?.qty),
      sellPrice: numberOrZero(r?.sellPrice),
      feeFlat: r?.feeFlat == null || r?.feeFlat === '' ? null : numberOrZero(r.feeFlat),
      currency: toUpper(r?.currency || '') || null,
      comment: String(r?.comment ?? '').trim(),
    }))
    .filter((r) => r.symbol && r.qty > 0 && r.sellPrice >= 0);

  return JSON.stringify({ targets, buys, sales });
}

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
  const sym = toUpper(symbol);
  if (!sym) return null;

  const stock = await getStockQuotes([sym]);
  const stockPrice = Number(stock?.[sym]?.price);
  if (Number.isFinite(stockPrice) && stockPrice > 0) {
    return { price: stockPrice, source: 'market-stock' };
  }

  for (const quoteCur of ['USD', 'USDT', 'USDC']) {
    const providerSymbol = `${sym}-${quoteCur}`;
    const crypto = await getCryptoQuotes([{ assetSymbol: sym, providerName: 'coinbase', providerSymbol }]);
    const price = Number(crypto?.[sym]?.price);
    if (Number.isFinite(price) && price > 0) {
      return { price, source: 'market-crypto' };
    }
  }

  return null;
}

async function fetchMarketPriceCandidatesBatch(symbols = []) {
  const unique = Array.from(
    new Set((symbols || []).map((s) => toUpper(s)).filter(Boolean)),
  );
  const fetchedPriceMap = new Map();
  if (unique.length === 0) return fetchedPriceMap;

  const stockQuotes = await getStockQuotes(unique);

  const missingAfterStock = [];
  for (const symbol of unique) {
    const stockPrice = Number(stockQuotes?.[symbol]?.price);
    if (Number.isFinite(stockPrice) && stockPrice > 0) {
      fetchedPriceMap.set(symbol, { price: stockPrice, source: 'market-stock' });
    } else {
      missingAfterStock.push(symbol);
    }
  }

  // Coinbase fallback sweep: USD → USDT → USDC (batched), only for still-missing symbols.
  const tryCoinbaseQuote = async (quoteCur, remaining) => {
    if (!remaining || remaining.length === 0) return [];
    const targets = remaining.map((symbol) => ({
      assetSymbol: symbol,
      providerName: 'coinbase',
      providerSymbol: `${symbol}-${quoteCur}`,
    }));
    const cryptoQuotes = await getCryptoQuotes(targets);
    const stillMissing = [];
    for (const symbol of remaining) {
      const cryptoPrice = Number(cryptoQuotes?.[symbol]?.price);
      if (Number.isFinite(cryptoPrice) && cryptoPrice > 0) {
        fetchedPriceMap.set(symbol, { price: cryptoPrice, source: 'market-crypto' });
      } else {
        stillMissing.push(symbol);
      }
    }
    return stillMissing;
  };

  let remaining = missingAfterStock;
  remaining = await tryCoinbaseQuote('USD', remaining);
  remaining = await tryCoinbaseQuote('USDT', remaining);
  remaining = await tryCoinbaseQuote('USDC', remaining);

  return fetchedPriceMap;
}

export function computeWhatIfFromData({
  scenario,
  targetPrices,
  hypotheticalPurchases,
  hypotheticalSales = [],
  baselineRows,
  baselineTotalValue,
  baselineTotalCost,
  baseCurrency = 'USD',
  fxRates = {},
  fetchedPriceMap = new Map(),
}) {
  const targetMap = new Map(targetPrices.map((row) => [toUpper(row.symbol), row]));
  const hasSecondaryTargetPrices = (targetPrices || []).some((r) => numberOrZero(r?.targetPrice2) > 0);

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

  let saleIndex = 0;
  for (const sale of hypotheticalSales || []) {
    saleIndex += 1;
    const symbol = toUpper(sale.symbol);
    const qty = numberOrZero(sale.qty);
    const sellPrice = numberOrZero(sale.sellPrice);
    if (qty <= 0) continue;
    const existing = rowsBySymbol.get(symbol);
    if (!existing || numberOrZero(existing.scenarioQty) <= 0) {
      throw new Error(
        `Hypothetical sale row ${saleIndex}: no position or zero quantity for ${symbol} after hypothetical buys.`,
      );
    }
    const available = numberOrZero(existing.scenarioQty);
    if (qty > available + 1e-9) {
      throw new Error(
        `Hypothetical sale row ${saleIndex}: cannot sell ${qty} of ${symbol}; only ${available} available in scenario.`,
      );
    }
    const costBasis = numberOrZero(existing.scenarioCostBasis);
    const removedCost = available > 0 ? (costBasis * qty) / available : 0;
    const nextQty = available - qty;
    const nextCost = Math.max(0, costBasis - removedCost);
    existing.scenarioQty = nextQty;
    existing.scenarioCostBasis = nextCost;
    existing.scenarioAvgCost = nextQty > 0 ? nextCost / nextQty : 0;
    const rowCur = toUpper(sale.currency || existing.currency || 'USD') || 'USD';
    existing.currency = rowCur;
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
    const overridePrice2 = numberOrZero(override?.targetPrice2);
    const fetched = fetchedPriceMap.get(row.symbol);
    const marketPrice = row.baselinePrice > 0 ? row.baselinePrice : numberOrZero(fetched?.price);
    const marketSource = row.baselinePrice > 0 ? 'dashboard' : fetched?.source || 'none';
    const scenarioPrice = overridePrice > 0 ? overridePrice : marketPrice > 0 ? marketPrice : row.scenarioAvgCost;
    const scenarioSource = overridePrice > 0 ? 'target-price' : marketPrice > 0 ? marketSource : 'buy-price-fallback';
    const baselineValue = row.baselineQty * marketPrice;
    const scenarioValue = row.scenarioQty * scenarioPrice;
    const pnl = scenarioValue - row.scenarioCostBasis;
    const baseRow = {
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
    if (!hasSecondaryTargetPrices) return baseRow;
    const scenarioPrice2 =
      overridePrice2 > 0 ? overridePrice2 : marketPrice > 0 ? marketPrice : row.scenarioAvgCost;
    const scenarioSource2 =
      overridePrice2 > 0 ? 'target-price' : marketPrice > 0 ? marketSource : 'buy-price-fallback';
    const scenarioValue2 = row.scenarioQty * scenarioPrice2;
    const pnl2 = scenarioValue2 - row.scenarioCostBasis;
    return {
      ...baseRow,
      scenarioPrice2,
      scenarioPriceSource2: scenarioSource2,
      scenarioValue2,
      pnl2,
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

  const scenarioTotals2 = hasSecondaryTargetPrices
    ? scenarioRows.reduce(
        (acc, row) => {
          acc.value += numberOrZero(row.scenarioValue2);
          acc.cost += numberOrZero(row.scenarioCostBasis ?? row.costBasis);
          acc.pnl += numberOrZero(row.pnl2);
          return acc;
        },
        { value: 0, cost: 0, pnl: 0 },
      )
    : null;

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
  if (hasSecondaryTargetPrices) {
    const scenarioValue2BaseSum = scenarioRows.reduce((sum, row) => {
      const scenarioValue2Base = toBaseValue(numberOrZero(row.scenarioValue2), row.currency);
      return sum + (scenarioValue2Base == null ? 0 : scenarioValue2Base);
    }, 0);
    portfolioBaseTotals.scenarioValue2 = scenarioValue2BaseSum;
    portfolioBaseTotals.deltaValue2 = scenarioValue2BaseSum - portfolioBaseTotals.baselineValue;
  }
  portfolioBaseTotals.hypotheticalCostBase = (hypotheticalPurchases || []).reduce((sum, item) => {
    const qty = numberOrZero(item?.qty);
    const buyPrice = numberOrZero(item?.buyPrice);
    const currency = toUpper(item?.currency || 'USD');
    const costBase = toBaseValue(qty * buyPrice, currency);
    return sum + (costBase == null ? 0 : costBase);
  }, 0);
  portfolioBaseTotals.hypotheticalProceedsBase = (hypotheticalSales || []).reduce((sum, item) => {
    const qty = numberOrZero(item?.qty);
    const sellPrice = numberOrZero(item?.sellPrice);
    const proceeds = Math.max(0, qty * sellPrice);
    const currency = toUpper(item?.currency || 'USD');
    const proceedsBase = toBaseValue(proceeds, currency);
    return sum + (proceedsBase == null ? 0 : proceedsBase);
  }, 0);

  const enrichedRows = scenarioRows.map((row) => {
    const enriched = {
      ...row,
      baselineWeightPct: baselineTotalValue > 0 ? (numberOrZero(row.baselineValue) / baselineTotalValue) * 100 : 0,
      scenarioWeightPct: scenarioTotals.value > 0 ? (numberOrZero(row.scenarioValue) / scenarioTotals.value) * 100 : 0,
    };
    if (hasSecondaryTargetPrices && scenarioTotals2) {
      enriched.scenarioWeightPct2 =
        scenarioTotals2.value > 0 ? (numberOrZero(row.scenarioValue2) / scenarioTotals2.value) * 100 : 0;
    }
    return enriched;
  });

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
    ...(hasSecondaryTargetPrices && scenarioTotals2 ? { scenarioTotals2 } : {}),
    portfolioBaseTotals,
    hasSecondaryTargetPrices,
    targetPrices,
    hypotheticalPurchases,
    hypotheticalSales,
    rows: enrichedRows.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

export async function computeWhatIfScenarioResults({ userId, scenarioId, baseCurrency = 'USD' }) {
  const t0 = nowMs();
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');

  const tScenario = nowMs();
  const [targetPrices, hypotheticalPurchases, hypotheticalSales] = await Promise.all([
    listWhatIfTargetPrices({ userId, scenarioId }),
    listWhatIfHypotheticalPurchases({ userId, scenarioId }),
    listWhatIfHypotheticalSales({ userId, scenarioId }),
  ]);
  const tInputs = nowMs();

  const base = toUpper(baseCurrency || 'USD') || 'USD';
  const inputsHash = stableInputsHash({ targetPrices, hypotheticalPurchases, hypotheticalSales });
  const cacheKey = `${String(userId)}:${String(scenarioId)}:${base}:${inputsHash}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    logTiming(
      { userId, scenarioId, baseCurrency: base, cached: true },
      {
        totalMs: nowMs() - t0,
        getScenarioMs: tScenario - t0,
        loadInputsMs: tInputs - tScenario,
        cacheHitMs: nowMs() - tInputs,
      },
    );
    return cached;
  }

  // What-if results don't need the full dashboard payload (cash/history/benchmarks).
  // Load only what we need: positions + live quotes for baseline prices, and FX for base conversion.
  const [positions, txAggRows] = await Promise.all([
    listPortfolioPositions(userId),
    listPositionTransactionAggregates(userId),
  ]);
  const tPositions = nowMs();
  const effectivePositions = applyTransactionAggregatesToPositions(positions, txAggRows);
  const [stockQuotes, cryptoQuotes] = await Promise.all([
    getStockQuoteMapForPositions(effectivePositions),
    getCryptoQuoteMapForPositions(effectivePositions),
  ]);
  const tQuotes = nowMs();
  const portfolio = buildPortfolioPayload({ positions: effectivePositions, stockQuotes, cryptoQuotes });
  const tPortfolio = nowMs();

  const baselineRows = Array.isArray(portfolio?.tableRows) ? portfolio.tableRows : [];
  const baselineTotalValue = numberOrZero(portfolio?.totals?.value);
  const baselineTotalCost = numberOrZero(portfolio?.totals?.cost);

  const fxCurrencies = [
    base,
    ...new Set(
      [
        ...baselineRows.map((row) => toUpper(row.currency || 'USD')),
        ...hypotheticalPurchases.map((row) => toUpper(row.currency || 'USD')),
        ...hypotheticalSales.map((row) => toUpper(row.currency || 'USD')),
      ].filter(Boolean),
    ),
  ];
  const fxBundle = await resolveLiveFxRates(fxCurrencies);
  const fxRates = fxBundle?.rates || {};
  const fxProviderLabel = String(fxBundle?.providerLabel || '');
  const tFx = nowMs();
  const baselinePriceBySymbol = new Map(
    baselineRows.map((row) => [toUpper(row.symbol), numberOrZero(row.currentPrice)]),
  );
  const symbolsMissingBaselinePrice = Array.from(
    new Set(
      [
        // Baseline holdings with no price (true missing)
        ...baselineRows.filter((row) => numberOrZero(row.currentPrice) <= 0).map((row) => toUpper(row.symbol)),
        // Hypothetical buy symbols should only be fetched if they are not already priced by baseline
        ...hypotheticalPurchases
          .map((row) => toUpper(row.symbol))
          .filter((sym) => {
            const baselinePrice = baselinePriceBySymbol.get(sym);
            return !Number.isFinite(baselinePrice) || baselinePrice <= 0;
          }),
        ...hypotheticalSales
          .map((row) => toUpper(row.symbol))
          .filter((sym) => {
            const baselinePrice = baselinePriceBySymbol.get(sym);
            return !Number.isFinite(baselinePrice) || baselinePrice <= 0;
          }),
      ].filter(Boolean),
    ),
  );
  const fetchedPriceMap = await fetchMarketPriceCandidatesBatch(symbolsMissingBaselinePrice);
  const tMissing = nowMs();

  const computed = computeWhatIfFromData({
    scenario,
    targetPrices,
    hypotheticalPurchases,
    hypotheticalSales,
    baselineRows,
    baselineTotalValue,
    baselineTotalCost,
    baseCurrency,
    fxRates,
    fetchedPriceMap,
  });
  const tCompute = nowMs();
  cacheSet(cacheKey, computed);
  logTiming(
    {
      userId,
      scenarioId,
      baseCurrency: base,
      cached: false,
      fxProvider: fxProviderLabel || null,
      counts: {
        positions: Array.isArray(effectivePositions) ? effectivePositions.length : 0,
        baselineRows: baselineRows.length,
        targetPrices: Array.isArray(targetPrices) ? targetPrices.length : 0,
        hypotheticalPurchases: Array.isArray(hypotheticalPurchases) ? hypotheticalPurchases.length : 0,
        hypotheticalSales: Array.isArray(hypotheticalSales) ? hypotheticalSales.length : 0,
        missingSymbols: symbolsMissingBaselinePrice.length,
      },
      missingSymbolsSample: symbolsMissingBaselinePrice.slice(0, 30),
      missingSymbolsTruncated: symbolsMissingBaselinePrice.length > 30,
    },
    {
      totalMs: tCompute - t0,
      getScenarioMs: tScenario - t0,
      loadInputsMs: tInputs - tScenario,
      loadPositionsMs: tPositions - tInputs,
      liveQuotesMs: tQuotes - tPositions,
      buildPortfolioMs: tPortfolio - tQuotes,
      fxMs: tFx - tPortfolio,
      fetchMissingPricesMs: tMissing - tFx,
      computeMs: tCompute - tMissing,
    },
  );
  return computed;
}
