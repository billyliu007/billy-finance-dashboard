export function parseMoney(value) {
  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** USDT and USDC are treated as USD for aggregation. */
export function normalizeCurrencyCode(currency) {
  const normalized = String(currency || 'USD').toUpperCase();
  if (normalized === 'RMB') return 'CNY';
  if (normalized === 'USDT' || normalized === 'USDC') return 'USD';
  return normalized;
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
