import { fetchWithTimeout } from './http.js';
import { fxCache } from './ttlCache.js';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
/** No API key; used when Frankfurter is down or incomplete (same USD-base semantics as Frankfurter). */
const OPEN_ER_API_LATEST_USD = 'https://open.er-api.com/v6/latest/USD';
const OPEN_ER_RAW_CACHE_KEY = 'fx:open-er:v6:latest-usd-raw';
const FX_TIMEOUT_MS = 10000;

export const FX_FALLBACK_PROVIDER_ID = 'open.er-api';

/** Currencies we fetch (all vs USD). */
const DEFAULT_FX_CURRENCIES = ['USD', 'CNY', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];

function buildToFetchList(extraCurrencies = []) {
  return [...new Set([...DEFAULT_FX_CURRENCIES, ...extraCurrencies])].filter(
    (c) => c && String(c).toUpperCase() !== 'USD',
  );
}

/**
 * True if any non-USD code in `codes` is missing or invalid in `rates`.
 * @param {Record<string, number>} rates
 * @param {string[]} codes uppercase currency codes excluding USD
 */
export function fxRatesMissingAny(rates, codes) {
  const unique = [...new Set(codes.map((c) => String(c || '').trim().toUpperCase()).filter((c) => c && c !== 'USD'))];
  for (const code of unique) {
    const v = Number(rates?.[code]);
    if (!Number.isFinite(v) || v <= 0) return true;
  }
  return false;
}

/**
 * Prefer primary per currency; fill gaps from secondary. Always sets USD: 1.
 * @param {Record<string, number>} primary
 * @param {Record<string, number>} secondary
 */
export function mergeUsdPerUnitRates(primary, secondary) {
  const out = { USD: 1 };
  const keys = new Set([
    ...Object.keys(primary || {}),
    ...Object.keys(secondary || {}),
  ].filter((k) => k && k !== 'USD'));
  for (const c of keys) {
    const a = Number(primary?.[c]);
    const b = Number(secondary?.[c]);
    if (Number.isFinite(a) && a > 0) out[c] = a;
    else if (Number.isFinite(b) && b > 0) out[c] = b;
  }
  return out;
}

/**
 * Fetch FX rates from Frankfurter (base is always USD).
 * Returns a mapping: { CURRENCY_CODE: usdValuePerUnit }
 * Example: if 1 USD = 7.2 CNY, returns { CNY: 0.1388... }
 */
export async function fetchFrankfurterFxRates(extraCurrencies = []) {
  const toFetch = buildToFetchList(extraCurrencies);

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

/**
 * Fetch FX from Open Exchange Rates API (open.er-api.com, USD base, no API key for /latest/USD).
 * Same shape as Frankfurter: USD per 1 unit of each currency.
 */
export async function fetchOpenErApiFxRates(extraCurrencies = []) {
  const toFetch = buildToFetchList(extraCurrencies);

  let rawRates = fxCache.get(OPEN_ER_RAW_CACHE_KEY);
  if (!rawRates || typeof rawRates !== 'object') {
    let response;
    try {
      response = await fetchWithTimeout(OPEN_ER_API_LATEST_USD, { timeoutMs: FX_TIMEOUT_MS });
    } catch {
      return { USD: 1 };
    }
    if (!response.ok) {
      return { USD: 1 };
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return { USD: 1 };
    }
    if (body?.result !== 'success' || !body?.rates || typeof body.rates !== 'object') {
      return { USD: 1 };
    }
    rawRates = body.rates;
    fxCache.set(OPEN_ER_RAW_CACHE_KEY, rawRates);
  }

  const result = { USD: 1 };
  for (const currency of toFetch) {
    const unitsPerUsd = Number(rawRates[currency]);
    if (Number.isFinite(unitsPerUsd) && unitsPerUsd > 0) {
      result[currency] = 1 / unitsPerUsd;
    }
  }
  return result;
}

/**
 * Frankfurter first; if rates are incomplete for defaults + extra currencies, merge Open ER API.
 * @param {string[]} extraCurrencies
 * @param {{ disableFallback?: boolean }} [options]
 * @returns {Promise<{ rates: Record<string, number>, providersUsed: string[] }>}
 */
export async function fetchFxRatesWithFallback(extraCurrencies = [], options = {}) {
  const { disableFallback = false } = options;
  const toFetch = buildToFetchList(extraCurrencies);
  const requiredCodes = toFetch;

  const primary = await fetchFrankfurterFxRates(extraCurrencies);
  const primaryAloneOk = !fxRatesMissingAny(primary, requiredCodes);

  if (disableFallback || primaryAloneOk) {
    return { rates: primary, providersUsed: ['frankfurter'] };
  }

  const secondary = await fetchOpenErApiFxRates(extraCurrencies);
  const merged = mergeUsdPerUnitRates(primary, secondary);
  const mergedOk = !fxRatesMissingAny(merged, requiredCodes);

  const frankfurterUseful = Object.keys(primary).length > 1;
  const secondaryUseful = Object.keys(secondary).length > 1;
  const fb = FX_FALLBACK_PROVIDER_ID;

  let providersUsed;
  if (mergedOk && frankfurterUseful && secondaryUseful) {
    providersUsed = ['frankfurter', fb];
  } else if (mergedOk && secondaryUseful) {
    providersUsed = [fb];
  } else {
    providersUsed = frankfurterUseful ? ['frankfurter'] : secondaryUseful ? [fb] : ['frankfurter'];
  }

  return { rates: merged, providersUsed };
}
