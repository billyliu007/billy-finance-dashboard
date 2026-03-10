import {
  buildDynamicDomain,
  normalizeCurrencyCode,
  percentFromReference,
} from '../lib/number.js';

const NET_WORTH_COMPONENTS = [
  { key: 'sgd_assets_in_cny', displayName: 'SGD Assets Total (As in CNY)' },
  { key: 'usd_assets_in_cny', displayName: 'USD Assets Total (As in CNY)' },
  { key: 'cny_assets_total', displayName: 'CNY Assets Total' },
];

function shouldHideCashRow(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return true;
  }
  // Hide only exact 0. Any negative value is a debt and should remain visible.
  return num === 0;
}

function buildDetailRows(cashComponents, fxRates) {
  return (cashComponents || []).map((item) => {
    const type = String(item.type || 'asset').toLowerCase() === 'liability' ? 'liability' : 'asset';
    const category = item.category || 'Cash';
    const currency = normalizeCurrencyCode(item.currency || 'CNY');
    const amount = Number(item.amount || 0);
    const signedValue = type === 'liability' ? -Math.abs(amount) : amount;
    const rate = fxRates[currency];

    return {
      key: item.key,
      name: item.name || item.displayName || item.key,
      type,
      category,
      currency,
      value: signedValue,
      fxRate: Number.isFinite(rate) ? rate : null,
      cnyValue: Number.isFinite(rate) ? signedValue * rate : null,
      found: true,
    };
  });
}

function isStockAsset(asset) {
  return /stock/i.test(String(asset?.category || ''));
}

function isCryptoAsset(asset) {
  return /crypto/i.test(String(asset?.category || ''));
}

function resolvePositionCurrentPrice(asset, stockQuotes, cryptoQuotes) {
  if (!isStockAsset(asset) && !isCryptoAsset(asset)) {
    return Number(asset?.purchasePrice || 0);
  }

  const symbol = String(asset?.symbol || asset?.name || '').trim().toUpperCase();
  const livePrice = isStockAsset(asset)
    ? Number(stockQuotes?.[symbol]?.price)
    : Number(cryptoQuotes?.[symbol]?.price);
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return null;
  }

  return livePrice;
}

function computeUsdPositionsTotal(positions, stockQuotes = {}, cryptoQuotes = {}) {
  return (positions || []).reduce((sum, asset) => {
    const qty = Number(asset?.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      return sum;
    }
    const currentPrice = resolvePositionCurrentPrice(asset, stockQuotes, cryptoQuotes);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return sum;
    }
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
  return visibleDetailRows
    .filter((item) => !shouldHideCashRow(item.value))
    .map((item) => ({
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
  return (rows || [])
    .map((row) => ({
      date: String(row?.date || '').trim(),
      recordedAtUtc: String(row?.recordedAtUtc || '').trim(),
      netWorth: Number(row?.netWorth || 0),
    }))
    .filter((item) => item.date !== '' && Number.isFinite(item.netWorth))
    .map((item) => ({
      ...item,
      // Keep date-only for chart x-axis density, but expose timestamp for UI local-time formatting.
      dateTimeLabel: item.recordedAtUtc || item.date,
    }));
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
      recordedAtUtc: item.recordedAtUtc,
      dateTimeLabel: item.dateTimeLabel,
    }));
}

function summarizeCashflow(cashflowData) {
  if (cashflowData.length === 0) {
    return {
      latest: { date: '-', netWorth: 0 },
      peak: { date: '-', netWorth: 0 },
      bottom: { date: '-', netWorth: 0 },
      latestPeriodChangePct: 0,
      latestPeriodStart: null,
      latestPeriodEnd: null,
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
    latestPeriodStart: previous ? (previous.dateTimeLabel || previous.recordedAtUtc || previous.date) : null,
    latestPeriodEnd: latest.dateTimeLabel || latest.recordedAtUtc || latest.date,
    latestPeriodSubtitle: previous ? `${previous.date} -> ${latest.date}` : latest.date,
  };
}

export function buildNetWorthPayload({
  cashComponents = [],
  positions = [],
  history = [],
  stockQuotes = {},
  cryptoQuotes = {},
  fxRatesOverride = {},
}) {
  const fxRates = {
    CNY: 1,
    ...Object.entries(fxRatesOverride).reduce((acc, [currency, rate]) => {
      const parsedRate = Number(rate);
      if (Number.isFinite(parsedRate) && parsedRate > 0) {
        acc[String(currency || '').toUpperCase()] = parsedRate;
      }
      return acc;
    }, {}),
  };
  const detailRows = buildDetailRows(cashComponents, fxRates);
  const visibleDetailRows = detailRows.filter((item) => item.found);
  const cashRows = mapCashDetailRowsToTableRows(visibleDetailRows);
  const usdPositionsTotal = computeUsdPositionsTotal(positions, stockQuotes, cryptoQuotes);
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
  const cashflowData = parseCashflowRows(history);
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
      hasData: detailRows.length > 0,
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
