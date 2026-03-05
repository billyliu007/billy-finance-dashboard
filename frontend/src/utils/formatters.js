export function formatMaybeHidden(hideValues, formatter, value, hiddenText = 'Hidden') {
  if (hideValues) {
    return hiddenText;
  }
  return formatter(value);
}

export function parseMoney(value) {
  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCurrencyCode(currency) {
  const normalized = String(currency || 'USD').toUpperCase();
  return normalized === 'RMB' ? 'CNY' : normalized;
}

export function formatCny(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCurrencyValue(value, currency = 'USD') {
  const normalized = normalizeCurrencyCode(currency);
  const locale = normalized === 'CNY' ? 'zh-CN' : 'en-US';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalized,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
    }).format(value);
  }
}

export function formatQty(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
  }).format(value);
}

export function formatFxRate(value) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatPercent(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatPercentUnsigned(value) {
  return `${value.toFixed(2)}%`;
}

export function percentFromReference(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) {
    return 0;
  }
  return ((current - reference) / Math.abs(reference)) * 100;
}

export function buildDynamicDomain(data, key) {
  if (!Array.isArray(data) || data.length === 0) {
    return ['auto', 'auto'];
  }

  const values = data.map((item) => Number(item[key]) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.02, 1);
    return [min - padding, max + padding];
  }

  const span = max - min;
  const padding = span * 0.08;
  return [min - padding, max + padding];
}
