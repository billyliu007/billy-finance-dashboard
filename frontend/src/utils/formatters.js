export function formatMaybeHidden(hideValues, formatter, value, hiddenText = 'Hidden') {
  if (hideValues) {
    return hiddenText;
  }
  return formatter(value);
}

export function normalizeCurrencyCode(currency) {
  const normalized = String(currency || 'USD').toUpperCase();
  if (normalized === 'RMB') return 'CNY';
  if (normalized === 'USDT' || normalized === 'USDC') return 'USD';
  return normalized;
}

export function formatCny(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format a number as currency in the given base currency (e.g. USD, CNY). */
export function formatBaseCurrency(value, baseCurrency = 'USD') {
  return formatCurrencyValue(value, baseCurrency);
}

export function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatMoneyPrecise(value, { minimumFractionDigits = 5, maximumFractionDigits = 8 } = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

export function formatCurrencyValue(value, currency = 'USD') {
  const normalized = normalizeCurrencyCode(currency);
  const locale = normalized === 'CNY' ? 'zh-CN' : 'en-US';

  if (normalized === 'SGD') {
    const abs = Math.abs(value);
    const numberPart = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2,
    }).format(abs);
    const sign = value < 0 ? '-' : '';
    return `${sign}S$${numberPart}`;
  }


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

export function formatLocalDateTime(value, { includeSeconds = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '-';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(parsed);
}
