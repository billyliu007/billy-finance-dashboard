import { fetchWithTimeout } from './http.js';
import { fxCache } from './ttlCache.js';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const FX_TIMEOUT_MS = 10000;

/** Currencies we fetch (all vs USD). */
const DEFAULT_FX_CURRENCIES = ['USD', 'CNY', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];

/**
 * Fetch FX rates from Frankfurter (base is always USD).
 * Returns a mapping: { CURRENCY_CODE: usdValuePerUnit }
 * Example: if 1 USD = 7.2 CNY, returns { CNY: 0.1388... }
 */
export async function fetchFrankfurterFxRates(extraCurrencies = []) {
  const toFetch = [...new Set([...DEFAULT_FX_CURRENCIES, ...extraCurrencies])].filter(
    (c) => c && String(c).toUpperCase() !== 'USD'
  );

  const cacheKey = `fx:usd-base:${toFetch.sort().join(',')}`;
  const cached = fxCache.get(cacheKey);
  if (cached) return cached;

  const toParam = toFetch.join(',');
  const params = new URLSearchParams({ from: 'USD', to: toParam });

  let response;
  try {
    response = await fetchWithTimeout(`${FRANKFURTER_URL}?${params.toString()}`, {
      timeoutMs: FX_TIMEOUT_MS,
    });
  } catch (err) {
    return { USD: 1 };
  }

  if (!response.ok) {
    return { USD: 1 };
  }

  const body = await response.json();
  const rates = body?.rates;
  if (!rates || typeof rates !== 'object') {
    return { USD: 1 };
  }

  // Frankfurter rates are "1 USD = X CUR".
  // We want "1 CUR = (1/X) USD" so we can multiply: AmountInCur * Rate = AmountInUSD.
  const result = { USD: 1 };
  for (const currency of toFetch) {
    const unitsPerUsd = Number(rates[currency]);
    if (Number.isFinite(unitsPerUsd) && unitsPerUsd > 0) {
      result[currency] = 1 / unitsPerUsd;
    }
  }

  fxCache.set(cacheKey, result);
  return result;
}
