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
    const currencyDisplay = String(item.currency || 'USD').trim().toUpperCase() || 'USD';
    const currencyNormalized = normalizeCurrencyCode(currencyDisplay);

    // USD is the single computation pivot. fxRates[currency] = USD per 1 unit of that currency.
    // fxRates.USD is always 1 (hardcoded). All other currencies need their rate present to be valued.
    const rateToUsd = fxRates[currencyNormalized];
    const key = item.id ?? `cash_${currencyDisplay}_${String(item.name || '').replace(/\s+/g, '_')}`;

    return {
      key,
      name: item.name || 'Cash',
      type,
      category: 'Cash',
      currency: currencyDisplay,
      currencyNormalized,
      value: signedValue,
      fxRate: Number.isFinite(rateToUsd) ? rateToUsd : null,
      usdValue: Number.isFinite(rateToUsd) ? signedValue * rateToUsd : null,
      found: Number.isFinite(rateToUsd),
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
  const result = {};

  for (const currency of currencies) {
    const key = currencyToComponentKey(currency);
    const rows = visibleDetailRows.filter((item) => item.currencyNormalized === currency);

    const rateToUsd = fxRates[currency];
    const hasRate = Number.isFinite(rateToUsd) && rateToUsd > 0;

    const cashUsdSum = rows.reduce((sum, item) => sum + (item.usdValue ?? 0), 0);
    const positionsUsd = currency === 'USD' ? usdPositionsTotal : 0;
    const valueUsd = (Number.isFinite(cashUsdSum) ? cashUsdSum : 0) + positionsUsd;

    const hasCashWithRate = rows.length > 0 && rows.every((item) => item.usdValue != null);
    const hasPositions = currency === 'USD' && usdPositionsTotal > 0;
    const found = hasCashWithRate || hasPositions;

    let reason = null;
    if (!found) {
      if (!hasRate) reason = `Missing ${currency} FX rate to USD`;
      else reason = `No ${currency} cash or positions`;
    }

    result[key] = { found, valueUsd, reason };
  }

  return result;
}

// targetBasePerUsd = 1 / fxRates[base]: converts a USD amount into the display base currency.
function mapCashDetailRowsToTableRows(visibleDetailRows, baseCurrency = 'USD', targetBasePerUsd = null) {
  return visibleDetailRows
    .filter((item) => !shouldHideCashRow(item.value))
    .map((item) => {
      // USD is the pivot: amountBase = usdValue * (units of base per 1 USD)
      const amountBase = item.usdValue != null && Number.isFinite(targetBasePerUsd) && targetBasePerUsd > 0
        ? item.usdValue * targetBasePerUsd
        : null;
      return {
        id: item.key,
        key: `cash_${item.key}`,
        className: item.category,
        instrument: item.name,
        currency: item.currency,
        amountLocal: item.value,
        fxRate: item.fxRate,
        amountCny: amountBase,      // field name kept for frontend compatibility; holds base-currency amount
        amountClass: item.value >= 0 ? 'pos' : 'neg',
        amountCnyClass: amountBase == null ? '' : amountBase >= 0 ? 'pos' : 'neg',
      };
    });
}

/**
 * Resolve history rows to display values in base currency.
 * Uses stored CNY when base is CNY; uses stored USD when base is USD; otherwise converts via FX.
 * For non-native-currency bases (e.g. SGD), prefers the historically-saved FX rates from
 * row.metadata.fx_rates (written by the cron job) over the live rates, for accuracy.
 * Legacy rows without metadata fall back to the live fxRates.
 */
function parseCashflowRows(rows, baseCurrency, fxRates) {
  const base = String(baseCurrency || 'USD').trim().toUpperCase() || 'USD';

  // Live-rate fallbacks (used when no historical metadata is present)
  const liveusdPerBase = fxRates[base];
  const liveTargetBasePerUsd = (Number.isFinite(liveusdPerBase) && liveusdPerBase > 0) ? (1 / liveusdPerBase) : null;
  const liveusdPerCny = fxRates.CNY;

  return (rows || [])
    .map((row) => {
      const date = String(row?.date || '').trim();
      const recordedAtUtc = String(row?.recordedAtUtc || '').trim();

      const cnyRaw = row?.netWorthCny ?? row?.netWorth;
      const cnyValue = cnyRaw != null && Number.isFinite(Number(cnyRaw)) ? Number(cnyRaw) : null;
      const usdValueStored = row?.netWorthUsd != null && Number.isFinite(Number(row.netWorthUsd)) ? Number(row.netWorthUsd) : null;

      // Prefer historically-saved FX rates from metadata (written by cron job) for non-native paths.
      // CNY and USD branches read native columns directly, so historical rates only matter for the
      // conversion fallback branch (base is something other than CNY / USD, e.g. SGD).
      const historicalFx = row?.metadata?.fx_rates;
      const resolvedFx = (historicalFx && typeof historicalFx === 'object') ? historicalFx : fxRates;

      const usdPerBase = resolvedFx[base];
      const targetBasePerUsd = (Number.isFinite(usdPerBase) && usdPerBase > 0) ? (1 / usdPerBase) : liveTargetBasePerUsd;
      const usdPerCny = resolvedFx.CNY ?? liveusdPerCny;

      let netWorthValue = null;

      // 1. If base is CNY, prioritize the native recorded cnyValue (no conversion needed)
      if (base === 'CNY' && cnyValue != null) {
        netWorthValue = cnyValue;
      }
      // 2. If base is USD, prioritize the modern netWorthUsd column (no conversion needed)
      else if (base === 'USD' && usdValueStored != null) {
        netWorthValue = usdValueStored;
      }
      // 3. For other bases (e.g. SGD): convert via historical FX if available, else live rate
      else {
        let effectiveUsdValue = usdValueStored;
        if (effectiveUsdValue == null && cnyValue != null && usdPerCny != null) {
          // Legacy row: only CNY recorded — convert CNY -> USD first using the best available rate
          effectiveUsdValue = cnyValue * usdPerCny;
        }

        if (effectiveUsdValue != null) {
          if (base === 'USD') {
            netWorthValue = effectiveUsdValue;
          } else if (targetBasePerUsd != null) {
            netWorthValue = effectiveUsdValue * targetBasePerUsd;
          }
        }
      }

      if (netWorthValue == null || !Number.isFinite(netWorthValue) || date === '') return null;

      return {
        date,
        recordedAtUtc,
        netWorth: netWorthValue,
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
    USD: 1, // Base of our universe
    ...Object.entries(fxRatesOverride).reduce((acc, [currency, rate]) => {
      const parsedRate = Number(rate);
      if (Number.isFinite(parsedRate) && parsedRate > 0) {
        acc[String(currency || '').toUpperCase()] = parsedRate;
      }
      return acc;
    }, {}),
  };

  const usdPerBase = fxRates[base];
  const targetBasePerUsd = (Number.isFinite(usdPerBase) && usdPerBase > 0) ? (1 / usdPerBase) : null;

  const detailRows = buildDetailRows(cashComponents, fxRates);
  const visibleDetailRows = detailRows.filter((item) => item.found);

  // targetBasePerUsd: how many units of the display base you get for 1 USD.
  // Used consistently everywhere — single USD pivot, no CNY middleman.
  const cashRows = mapCashDetailRowsToTableRows(visibleDetailRows, base, targetBasePerUsd);
  const usdPositionsTotal = computeUsdPositionsTotal(positions, stockQuotes, cryptoQuotes);
  const aggregatedTotalsByKey = aggregateComputedTotalsUsd(visibleDetailRows, usdPositionsTotal, fxRates);
  const orderedKeys = Object.keys(aggregatedTotalsByKey).sort((a, b) => {
    if (a === 'cny_assets_total') return -1;
    if (b === 'cny_assets_total') return 1;
    return a.localeCompare(b);
  });
  const componentValuesAll = orderedKeys.map((key) => {
    const agg = aggregatedTotalsByKey[key] || { found: false, valueUsd: 0, reason: 'Missing data' };
    const valueInBase = (agg.valueUsd != null && targetBasePerUsd != null)
      ? agg.valueUsd * targetBasePerUsd
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
