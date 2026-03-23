import { fetchWithTimeout } from './http.js';
import { fxCache } from './ttlCache.js';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const FX_TIMEOUT_MS = 10000;

/** Currencies we fetch (all vs USD, then derive to CNY). */
const DEFAULT_FX_CURRENCIES = ['USD', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];

/**
 * Fetch FX rates to CNY in a single request: from=USD&to=CNY,SGD,EUR,GBP,JPY,HKD,
 * then derive each currency → CNY (USD/CNY from rates.CNY, EUR/CNY = rates.CNY/rates.EUR, etc.).
 */
export async function fetchFrankfurterFxRates(extraCurrencies = []) {
  const toFetch = [...new Set([...DEFAULT_FX_CURRENCIES, ...extraCurrencies])].filter(
    (c) => c && String(c).toUpperCase() !== 'CNY'
  );
  if (toFetch.length === 0) {
    return {};
  }

  const cacheKey = `fx:${toFetch.sort().join(',')}`;
  const cached = fxCache.get(cacheKey);
  if (cached) return cached;

  const toParam = ['CNY', ...toFetch.filter((c) => c !== 'USD')].join(',');
  const params = new URLSearchParams({ from: 'USD', to: toParam });

  let response;
  try {
    response = await fetchWithTimeout(`${FRANKFURTER_URL}?${params.toString()}`, {
      timeoutMs: FX_TIMEOUT_MS,
    });
  } catch (err) {
    return {};
  }

  if (!response.ok) {
    return {};
  }

  const body = await response.json();
  const rates = body?.rates;
  if (!rates || typeof rates !== 'object') {
    return {};
  }

  const usdToCny = Number(rates.CNY);
  if (!Number.isFinite(usdToCny) || usdToCny <= 0) {
    return {};
  }

  const result = { USD: usdToCny };
  for (const currency of toFetch) {
    if (currency === 'USD') continue;
    const usdToCur = Number(rates[currency]);
    if (Number.isFinite(usdToCur) && usdToCur > 0) {
      result[currency] = usdToCny / usdToCur;
    }
  }

  fxCache.set(cacheKey, result);
  return result;
}
