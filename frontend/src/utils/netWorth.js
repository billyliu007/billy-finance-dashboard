import { normalizeCurrencyCode, parseMoney } from './formatters.js';
import { getCellValue } from './sheet.js';

export function buildFxRates(forexHeaders, forexRows, forexRatesConfig = []) {
  const rates = { CNY: 1 };

  forexRatesConfig.forEach((rateConfig) => {
    const currency = normalizeCurrencyCode(rateConfig.currency);
    const rawRate = parseMoney(getCellValue(forexHeaders, forexRows, rateConfig.cellRef));
    rates[currency] = rawRate > 0 ? rawRate : null;
  });

  return rates;
}

export function buildDetailRows(headers, rows, detailItems, findComponentValue, config, fxRates) {
  return (detailItems || []).map((item) => {
    const result = findComponentValue(headers, rows, item, config);
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

export function computeUsdPositionsTotal(assets, headers, rows) {
  return assets.reduce((sum, asset) => {
    const qtyRaw = getCellValue(headers, rows, asset.qtyCell);
    const currentPriceRaw = getCellValue(headers, rows, asset.currentPriceCell);
    const hasData = [qtyRaw, currentPriceRaw].some((value) => String(value || '').trim() !== '');
    if (!hasData) {
      return sum;
    }

    const qty = parseMoney(qtyRaw);
    const currentPrice = parseMoney(currentPriceRaw);
    return sum + qty * currentPrice;
  }, 0);
}

export function aggregateComputedTotals(visibleDetailRows, usdPositionsTotal, fxRates) {
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

export function mapCashDetailRowsToTableRows(visibleDetailRows) {
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
