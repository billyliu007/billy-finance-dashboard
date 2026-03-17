import {
  buildDynamicDomain,
  normalizeCurrencyCode,
  percentFromReference,
} from '../lib/number.js';
import { resolvePositionPrice } from '../lib/priceResolution.js';

function currencyToComponentKey(currency) {
  return currency === 'CNY' ? 'cny_assets_total' : `${currency.toLowerCase()}_assets_in_cny`;
}

function componentKeyToDisplayName(key, baseCurrency = 'CNY') {
  const base = String(baseCurrency || 'CNY').toUpperCase();
  if (key === 'cny_assets_total') return 'CNY Assets Total';
  const match = key.match(/^([a-z]{3})_assets_in_cny$/i);
  const cur = match ? match[1].toUpperCase() : key;
  return `${cur} Assets Total (As in ${base})`;
}

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
    const balance = Number(item.balance ?? item.amount ?? 0);
    const signedValue = Number.isFinite(balance) ? balance : 0;
    const type = signedValue < 0 ? 'liability' : 'asset';
    const currencyDisplay = String(item.currency || 'CNY').trim().toUpperCase() || 'CNY';
    const currencyNormalized = normalizeCurrencyCode(currencyDisplay);
    const rateToCny = fxRates[currencyNormalized];
    const usdToCny = fxRates.USD;
    const rateToUsd =
      currencyNormalized === 'USD'
        ? 1
        : currencyNormalized === 'CNY'
          ? Number.isFinite(usdToCny) && usdToCny > 0
            ? 1 / usdToCny
            : null
          : Number.isFinite(rateToCny) && rateToCny > 0 && Number.isFinite(usdToCny) && usdToCny > 0
            ? rateToCny / usdToCny
            : null;
    const key = item.id ?? `cash_${currencyDisplay}_${String(item.name || '').replace(/\s+/g, '_')}`;

    return {
      key,
      name: item.name || 'Cash',
      type,
      category: 'Cash',
      currency: currencyDisplay,
      currencyNormalized,
      value: signedValue,
      fxRate: Number.isFinite(rateToCny) ? rateToCny : null,
      cnyValue: Number.isFinite(rateToCny) ? signedValue * rateToCny : null,
      usdValue: Number.isFinite(rateToUsd) ? signedValue * rateToUsd : null,
      found: true,
    };
  });
}

function computeUsdPositionsTotal(positions, stockQuotes = {}, cryptoQuotes = {}) {
  return (positions || []).reduce((sum, asset) => {
    const qty = Number(asset?.qty || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      return sum;
    }
    const { price: currentPrice } = resolvePositionPrice(asset, stockQuotes, cryptoQuotes);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return sum;
    }
    return sum + qty * currentPrice;
  }, 0);
}

function aggregateComputedTotalsUsd(visibleDetailRows, usdPositionsTotal, fxRates) {
  const currencies = new Set(visibleDetailRows.map((item) => item.currencyNormalized));
  if (usdPositionsTotal > 0) currencies.add('USD');
  const usdToCny = fxRates.USD;
  const result = {};

  for (const currency of currencies) {
    const key = currencyToComponentKey(currency);
    const rows = visibleDetailRows.filter((item) => item.currencyNormalized === currency);

    const hasUsdRate = Number.isFinite(usdToCny) && usdToCny > 0;
    const hasCurrencyRateToCny =
      currency === 'CNY' ? true : Number.isFinite(fxRates[currency]) && fxRates[currency] > 0;

    const cashUsdSum = rows.reduce((sum, item) => sum + (item.usdValue ?? 0), 0);
    const positionsUsd = currency === 'USD' ? usdPositionsTotal : 0;
    const valueUsd = (Number.isFinite(cashUsdSum) ? cashUsdSum : 0) + positionsUsd;

    const hasCashWithRate = rows.length > 0 && rows.every((item) => item.usdValue != null);
    const hasPositions = currency === 'USD' && usdPositionsTotal > 0;
    const found = hasCashWithRate || hasPositions;

    let reason = null;
    if (!found) {
      if (!hasUsdRate) reason = 'Missing USD/CNY rate';
      else if (!hasCurrencyRateToCny) reason = `Missing ${currency}/CNY rate`;
      else reason = `No ${currency} cash or positions`;
    }

    result[key] = { found, valueUsd, reason };
  }

  return result;
}

function mapCashDetailRowsToTableRows(visibleDetailRows, baseCurrency = 'CNY', rateToBase = 1) {
  return visibleDetailRows
    .filter((item) => !shouldHideCashRow(item.value))
    .map((item) => {
      const cnyVal = item.cnyValue;
      const amountBase = cnyVal != null && Number.isFinite(rateToBase) && rateToBase > 0
        ? cnyVal / rateToBase
        : null;
      return {
        id: item.key,
        key: `cash_${item.key}`,
        className: item.category,
        instrument: item.name,
        currency: item.currency,
        amountLocal: item.value,
        fxRate: item.fxRate,
        amountCny: amountBase,
        amountClass: item.value >= 0 ? 'pos' : 'neg',
        amountCnyClass: amountBase == null ? '' : amountBase >= 0 ? 'pos' : 'neg',
      };
    });
}

/**
 * Resolve history rows to display values in base currency.
 * Uses stored CNY when base is CNY; uses stored USD when base is USD; otherwise converts via FX.
 * Legacy rows have only netWorthCny (total_usd null).
 */
function parseCashflowRows(rows, baseCurrency, fxRates) {
  const base = String(baseCurrency || 'USD').trim().toUpperCase() || 'USD';
  const rateToBase = Number.isFinite(fxRates[base]) && fxRates[base] > 0 ? fxRates[base] : 1;
  const usdRate = Number.isFinite(fxRates.USD) && fxRates.USD > 0 ? fxRates.USD : null;

  return (rows || [])
    .map((row) => {
      const date = String(row?.date || '').trim();
      const recordedAtUtc = String(row?.recordedAtUtc || '').trim();
      const cnyRaw = row?.netWorthCny ?? row?.netWorth;
      const cny = cnyRaw != null && Number.isFinite(Number(cnyRaw)) ? Number(cnyRaw) : null;
      const usd = row?.netWorthUsd != null && Number.isFinite(Number(row.netWorthUsd)) ? Number(row.netWorthUsd) : null;

      let netWorth = null;
      if (base === 'CNY' && cny != null) {
        netWorth = cny;
      } else if (base === 'USD' && usd != null) {
        netWorth = usd;
      } else if (cny != null && rateToBase > 0) {
        netWorth = cny / rateToBase;
      } else if (usd != null && usdRate != null && rateToBase > 0) {
        netWorth = (usd * usdRate) / rateToBase;
      }
      if (netWorth == null || !Number.isFinite(netWorth) || date === '') return null;
      return {
        date,
        recordedAtUtc,
        netWorth,
        dateTimeLabel: recordedAtUtc || date,
      };
    })
    .filter(Boolean);
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

  // Supports ISO/date-time strings and plain date strings.
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

    // Keep the last point seen for the month (month-end in chronological data).
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
  baseCurrency = 'USD',
}) {
  const base = String(baseCurrency || 'USD').trim().toUpperCase() || 'USD';
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
  const usdToCny = fxRates.USD;
  const baseToCny = fxRates[base];
  const usdToBase =
    base === 'USD'
      ? 1
      : base === 'CNY'
        ? Number.isFinite(usdToCny) && usdToCny > 0
          ? usdToCny
          : null
        : Number.isFinite(usdToCny) && usdToCny > 0 && Number.isFinite(baseToCny) && baseToCny > 0
          ? usdToCny / baseToCny
          : null;
  const rateToBase = Number.isFinite(baseToCny) && baseToCny > 0 ? baseToCny : 1;

  const detailRows = buildDetailRows(cashComponents, fxRates);
  const visibleDetailRows = detailRows.filter((item) => item.found);
  const cashRows = mapCashDetailRowsToTableRows(visibleDetailRows, base, rateToBase);
  const usdPositionsTotal = computeUsdPositionsTotal(positions, stockQuotes, cryptoQuotes);
  const aggregatedTotalsByKey = aggregateComputedTotalsUsd(visibleDetailRows, usdPositionsTotal, fxRates);
  const orderedKeys = Object.keys(aggregatedTotalsByKey).sort((a, b) => {
    if (a === 'cny_assets_total') return -1;
    if (b === 'cny_assets_total') return 1;
    if (a === 'usd_assets_in_cny') return -1;
    if (b === 'usd_assets_in_cny') return 1;
    return a.localeCompare(b);
  });
  const componentValuesAll = orderedKeys.map((key) => {
    const agg = aggregatedTotalsByKey[key] || { found: false, valueUsd: 0, reason: 'Missing data' };
    const valueInBase =
      agg.valueUsd != null && Number.isFinite(usdToBase) && usdToBase > 0
        ? agg.valueUsd * usdToBase
        : null;
    return {
      key,
      name: componentKeyToDisplayName(key, base),
      ...agg,
      value: valueInBase,
    };
  });
  const missingInputs = componentValuesAll
    .filter((item) => !item.found)
    .map((item) => `${item.name}: ${item.reason || 'Missing data'}`);
  const totalNetWorth = componentValuesAll.reduce((sum, component) => sum + (component.value ?? 0), 0);
  // Exclude zero-value components from breakdown so it matches the cash table (which hides 0-balance rows)
  const componentValues = componentValuesAll.filter(
    (c) => c.value == null || !Number.isFinite(c.value) || Math.abs(c.value) >= 1e-9
  );

  const cashflowData = parseCashflowRows(history, base, fxRates);
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
