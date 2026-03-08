import DASHBOARD_CONFIG from '../config/dashboardConfig.js';
import PORTFOLIO_CONFIG from '../config/portfolioConfig.js';
import {
  buildDynamicDomain,
  normalizeCurrencyCode,
  parseMoney,
  percentFromReference,
} from '../lib/number.js';
import { findComponentValue, getCellValue } from '../lib/sheet.js';

const NET_WORTH_COMPONENTS = [
  { key: 'sgd_assets_in_cny', displayName: 'SGD Assets Total (As in CNY)' },
  { key: 'usd_assets_in_cny', displayName: 'USD Assets Total (As in CNY)' },
  { key: 'cny_assets_total', displayName: 'CNY Assets Total' },
];

function buildFxRates(forexHeaders, forexRows, forexRatesConfig = []) {
  const rates = { CNY: 1 };

  forexRatesConfig.forEach((rateConfig) => {
    const currency = normalizeCurrencyCode(rateConfig.currency);
    const rawRate = parseMoney(getCellValue(forexHeaders, forexRows, rateConfig.cellRef));
    rates[currency] = rawRate > 0 ? rawRate : null;
  });

  return rates;
}

function buildDetailRows(headers, rows, fxRates) {
  return (DASHBOARD_CONFIG.detailItems || []).map((item) => {
    const result = findComponentValue(headers, rows, item, DASHBOARD_CONFIG);
    const type = String(item.type || 'asset').toLowerCase() === 'liability' ? 'liability' : 'asset';
    const category = item.category || 'Other';
    const currency = normalizeCurrencyCode(item.currency || 'CNY');
    const signedValue = type === 'liability' ? -Math.abs(result.value) : result.value;
    const rate = fxRates[currency];

    return {
      key: item.key,
      name: item.displayName || item.labelMatch || item.key,
      type,
      category,
      currency,
      value: signedValue,
      fxRate: Number.isFinite(rate) ? rate : null,
      cnyValue: Number.isFinite(rate) ? signedValue * rate : null,
      found: result.found,
    };
  });
}

function isStockAsset(asset) {
  return /stock/i.test(String(asset?.category || ''));
}

function isCryptoAsset(asset) {
  return /crypto/i.test(String(asset?.category || ''));
}

function resolvePositionCurrentPrice(asset, currentPriceRaw, stockQuotes, cryptoQuotes) {
  const fallbackPrice = parseMoney(currentPriceRaw);
  if (!isStockAsset(asset) && !isCryptoAsset(asset)) {
    return fallbackPrice;
  }

  const symbol = String(asset?.name || '').trim().toUpperCase();
  const livePrice = isStockAsset(asset)
    ? Number(stockQuotes?.[symbol]?.price)
    : Number(cryptoQuotes?.[symbol]?.price);
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return fallbackPrice;
  }

  return livePrice;
}

function computeUsdPositionsTotal(headers, rows, stockQuotes = {}, cryptoQuotes = {}) {
  return PORTFOLIO_CONFIG.assets.reduce((sum, asset) => {
    const qtyRaw = getCellValue(headers, rows, asset.qtyCell);
    const currentPriceRaw = getCellValue(headers, rows, asset.currentPriceCell);
    const hasData = [qtyRaw, currentPriceRaw].some((value) => String(value || '').trim() !== '');
    if (!hasData) {
      return sum;
    }

    const qty = parseMoney(qtyRaw);
    const currentPrice = resolvePositionCurrentPrice(asset, currentPriceRaw, stockQuotes, cryptoQuotes);
    return sum + qty * currentPrice;
  }, 0);
}

function aggregateComputedTotals(visibleDetailRows, usdPositionsTotal, fxRates) {
  const sgdAssets = visibleDetailRows.filter((item) => item.type === 'asset' && item.currency === 'SGD');
  const cnyRows = visibleDetailRows.filter((item) => item.currency === 'CNY');
  const usdAssets = visibleDetailRows.filter((item) => item.type === 'asset' && item.currency === 'USD');
  const sgdAssetsInCny = sgdAssets.reduce((sum, item) => sum + (item.cnyValue ?? 0), 0);
  const cnyAssetsTotal = cnyRows.reduce((sum, item) => sum + item.value, 0);
  const usdCashTotal = usdAssets.reduce((sum, item) => sum + item.value, 0);
  const usdRate = fxRates.USD;
  const usdAssetsInCny = Number.isFinite(usdRate) ? (usdCashTotal + usdPositionsTotal) * usdRate : 0;
  const sgdFound = sgdAssets.length > 0 && sgdAssets.every((item) => item.cnyValue != null);
  const cnyFound = cnyRows.length > 0;
  const usdFound = Number.isFinite(usdRate) && (usdAssets.length > 0 || usdPositionsTotal > 0);

  return {
    sgd_assets_in_cny: {
      found: sgdFound,
      value: sgdAssetsInCny,
      reason: sgdFound ? null : sgdAssets.length === 0 ? 'No SGD cash rows' : 'Missing SGD/CNY rate',
    },
    cny_assets_total: {
      found: cnyFound,
      value: cnyAssetsTotal,
      reason: cnyFound ? null : 'No CNY cash rows',
    },
    usd_assets_in_cny: {
      found: usdFound,
      value: usdAssetsInCny,
      reason: usdFound ? null : !Number.isFinite(usdRate) ? 'Missing USD/CNY rate' : 'No USD cash or positions',
    },
  };
}

function mapCashDetailRowsToTableRows(visibleDetailRows) {
  return visibleDetailRows.map((item) => ({
    key: `cash_${item.key}`,
    className: item.category,
    instrument: item.name,
    currency: item.currency,
    amountLocal: item.value,
    fxRate: item.fxRate,
    amountCny: item.cnyValue,
    amountClass: item.value >= 0 ? 'pos' : 'neg',
    amountCnyClass: item.cnyValue == null ? '' : item.cnyValue >= 0 ? 'pos' : 'neg',
  }));
}

function parseCashflowRows(rows) {
  return rows
    .map((row) => ({
      date: String(row[0] || '').trim(),
      netWorth: parseMoney(row[1]),
    }))
    .filter((item) => item.date !== '' && item.netWorth !== 0);
}

function buildDerivedChangeSeries(cashflowData) {
  return cashflowData.map((item, index) => {
    if (index === 0) {
      return {
        ...item,
        derivedChangePct: 0,
        previousDate: null,
        previousNetWorth: null,
        currentDate: item.date,
        currentNetWorth: item.netWorth,
      };
    }

    const previous = cashflowData[index - 1];
    const derivedChangePct =
      previous.netWorth === 0 ? 0 : ((item.netWorth - previous.netWorth) / previous.netWorth) * 100;
    return {
      ...item,
      derivedChangePct,
      previousDate: previous.date,
      previousNetWorth: previous.netWorth,
      currentDate: item.date,
      currentNetWorth: item.netWorth,
    };
  });
}

function normalizeMonthKey(rawDate) {
  const value = String(rawDate || '').trim();
  if (!value) {
    return '';
  }

  // Supports ISO/date-time strings and plain date strings from sheets.
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  const datePart = value.includes('T') ? value.split('T')[0] : value.split(' ')[0];
  const [year, month] = datePart.split('-');
  if (!year || !month) {
    return '';
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function buildMonthEndSeries(cashflowData) {
  const latestByMonth = new Map();

  cashflowData.forEach((item, index) => {
    const monthKey = normalizeMonthKey(item.date);
    if (!monthKey) {
      return;
    }

    // Keep the last point seen for the month (month-end in chronological sheet data).
    latestByMonth.set(monthKey, { ...item, monthKey, order: index });
  });

  return Array.from(latestByMonth.values())
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      date: item.monthKey,
      netWorth: item.netWorth,
    }));
}

function summarizeCashflow(cashflowData) {
  if (cashflowData.length === 0) {
    return {
      latest: { date: '-', netWorth: 0 },
      peak: { date: '-', netWorth: 0 },
      bottom: { date: '-', netWorth: 0 },
      latestPeriodChangePct: 0,
      latestPeriodSubtitle: '-',
    };
  }

  const latest = cashflowData[cashflowData.length - 1];
  const peak = cashflowData.reduce((acc, item) => (item.netWorth > acc.netWorth ? item : acc), cashflowData[0]);
  const bottom = cashflowData.reduce((acc, item) => (item.netWorth < acc.netWorth ? item : acc), cashflowData[0]);
  const previous = cashflowData.length > 1 ? cashflowData[cashflowData.length - 2] : null;
  const latestPeriodChangePct = previous
    ? ((latest.netWorth - previous.netWorth) / previous.netWorth) * 100
    : 0;

  return {
    latest,
    peak,
    bottom,
    latestPeriodChangePct,
    latestPeriodSubtitle: previous ? `${previous.date} -> ${latest.date}` : latest.date,
  };
}

export function buildNetWorthPayload({
  netWorthSheet,
  forexSheet,
  portfolioSheet,
  cashflowSheet,
  stockQuotes = {},
  cryptoQuotes = {},
  fxRatesOverride = {},
}) {
  const headers = netWorthSheet.headers || [];
  const rows = netWorthSheet.rows || [];
  const forexHeaders = forexSheet.headers || [];
  const forexRows = forexSheet.rows || [];
  const portfolioHeaders = portfolioSheet.headers || [];
  const portfolioRows = portfolioSheet.rows || [];
  const cashflowRows = cashflowSheet.rows || [];

  const fxRates = {
    ...buildFxRates(forexHeaders, forexRows, DASHBOARD_CONFIG.forexRates),
    ...Object.entries(fxRatesOverride).reduce((acc, [currency, rate]) => {
      const parsedRate = Number(rate);
      if (Number.isFinite(parsedRate) && parsedRate > 0) {
        acc[String(currency || '').toUpperCase()] = parsedRate;
      }
      return acc;
    }, {}),
  };
  const detailRows = buildDetailRows(headers, rows, fxRates);
  const visibleDetailRows = detailRows.filter((item) => item.found);
  const cashRows = mapCashDetailRowsToTableRows(visibleDetailRows);
  const usdPositionsTotal = computeUsdPositionsTotal(portfolioHeaders, portfolioRows, stockQuotes, cryptoQuotes);
  const aggregatedTotalsByKey = aggregateComputedTotals(visibleDetailRows, usdPositionsTotal, fxRates);
  const componentValues = NET_WORTH_COMPONENTS.map((component) => ({
    key: component.key,
    name: component.displayName,
    ...(aggregatedTotalsByKey[component.key] || { found: false, value: 0, reason: 'Missing data' }),
  }));
  const missingInputs = componentValues
    .filter((item) => !item.found)
    .map((item) => `${item.name}: ${item.reason || 'Missing data'}`);
  const totalNetWorth = componentValues.reduce((sum, component) => sum + component.value, 0);
  const cashflowData = parseCashflowRows(cashflowRows);
  const monthEndSeries = buildMonthEndSeries(cashflowData);
  const derivedSeries = buildDerivedChangeSeries(monthEndSeries);
  const summary = summarizeCashflow(cashflowData);
  const netWorthDomain = buildDynamicDomain(cashflowData, 'netWorth');

  const netWorthBounds = cashflowData.length === 0
    ? null
    : {
      pctToAth: percentFromReference(
        totalNetWorth,
        cashflowData.reduce((acc, item) => (item.netWorth > acc.netWorth ? item : acc), cashflowData[0]).netWorth,
      ),
      pctToAtl: percentFromReference(
        totalNetWorth,
        cashflowData.reduce((acc, item) => (item.netWorth < acc.netWorth ? item : acc), cashflowData[0]).netWorth,
      ),
    };

  return {
    overview: {
      hasData: headers.length > 0,
      totalNetWorth,
      netWorthBounds,
      componentValues,
      missingInputs,
      cashRows,
    },
    performance: {
      hasData: cashflowData.length > 0,
      summary,
      cashflowData,
      derivedSeries,
      netWorthDomain,
    },
  };
}
