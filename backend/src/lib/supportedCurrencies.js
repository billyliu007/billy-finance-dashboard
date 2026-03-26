export const SUPPORTED_CURRENCY_CODES = Object.freeze([
  'USD',
  'USDT',
  'USDC',
  'CNY',
  'SGD',
  'EUR',
  'GBP',
  'JPY',
  'HKD',
]);

export function normalizeCurrencyCodeStrict(input) {
  return String(input || '').trim().toUpperCase();
}

export function isSupportedCurrencyCode(input) {
  const code = normalizeCurrencyCodeStrict(input);
  return SUPPORTED_CURRENCY_CODES.includes(code);
}

export function assertSupportedCurrencyCode(input, { fieldName = 'currency' } = {}) {
  const code = normalizeCurrencyCodeStrict(input);
  if (!code) {
    throw new Error(`${fieldName} is required.`);
  }
  if (!SUPPORTED_CURRENCY_CODES.includes(code)) {
    throw new Error(
      `${fieldName} must be one of: ${SUPPORTED_CURRENCY_CODES.join(', ')}.`,
    );
  }
  return code;
}

export function filterToSupportedCurrencyCodes(inputs = []) {
  const out = [];
  const seen = new Set();
  for (const raw of inputs || []) {
    const code = normalizeCurrencyCodeStrict(raw);
    if (!code || seen.has(code)) continue;
    if (SUPPORTED_CURRENCY_CODES.includes(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
