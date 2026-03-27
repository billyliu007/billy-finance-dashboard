import { fetchFxRatesWithFallback } from '../lib/fx.js';
import { stockProviders, cryptoProviders } from '../lib/marketDataProviders.js';
import { fxCache, marketDataCache } from '../lib/ttlCache.js';
import { filterToSupportedCurrencyCodes } from '../lib/supportedCurrencies.js';

const FX_PROVIDER = String(process.env.FX_PROVIDER || 'frankfurter').trim().toLowerCase();
/** Set to `none`, `off`, or `false` to use Frankfurter only. Any other value keeps secondary FX enabled. */
const FX_PROVIDER_FALLBACK = String(process.env.FX_PROVIDER_FALLBACK ?? 'open.er-api').trim().toLowerCase();

function fxFallbackDisabled() {
  return ['none', 'off', 'false'].includes(FX_PROVIDER_FALLBACK);
}

export function isFxFallbackDisabled() {
  return fxFallbackDisabled();
}

// Last-known-good FX cache (never expires during process lifetime).
// Used to avoid blocking interactive requests on slow FX providers.
const fxLastGood = new Map(); // code -> { rate: number, at: number }

// In-flight request de-dupe to prevent stampedes.
const inflight = new Map();

function inflightKey(kind, id) {
  return `${kind}:${id}`;
}

async function withInflight(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function normalizeSymbol(sym) {
  return String(sym || '').trim().toUpperCase();
}

function uniqueNonEmpty(list, normalizer = (x) => x) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const n = normalizer(v);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function rememberFx(code, rate) {
  const c = String(code || '').trim().toUpperCase();
  const v = Number(rate);
  if (!c || c === 'USD') return;
  if (!Number.isFinite(v) || v <= 0) return;
  fxLastGood.set(c, { rate: v, at: Date.now() });
}

function getLastGoodFx(code) {
  const c = String(code || '').trim().toUpperCase();
  const hit = fxLastGood.get(c);
  const v = Number(hit?.rate);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Central stock quote fetch with per-symbol caching.
 * @param {string[]} symbols
 * @returns {Promise<Record<string, { symbol: string, price: number, timestamp?: number|null, changePct?: number|null, source?: string }>>}
 */
export async function getStockQuotes(symbols = []) {
  const provider = stockProviders['finnhub'];
  if (!provider) return {};

  const normalized = uniqueNonEmpty(symbols, normalizeSymbol);
  if (normalized.length === 0) return {};

  const out = {};
  const missing = [];
  for (const sym of normalized) {
    const key = `quote:stock:${sym}`;
    const cached = marketDataCache.get(key);
    if (cached) out[sym] = cached;
    else missing.push(sym);
  }

  if (missing.length === 0) return out;

  const batchKey = inflightKey('stockQuotes', missing.sort().join(','));
  const fetched = await withInflight(batchKey, async () => provider.getQuotes(
    missing.map((s) => ({ assetSymbol: s, providerSymbol: s }))
  ));

  for (const sym of missing) {
    const q = fetched?.[sym] || null;
    if (q) {
      marketDataCache.set(`quote:stock:${sym}`, q);
      out[sym] = q;
    }
  }

  return out;
}

/**
 * Central crypto quote fetch with per-instrument caching.
 * Cache key uses providerName + providerSymbol because a single asset symbol may have multiple products.
 * @param {Array<{ assetSymbol: string, providerName: string, providerSymbol: string }>} targets
 * @returns {Promise<Record<string, any>>} map keyed by assetSymbol (matches existing callers)
 */
export async function getCryptoQuotes(targets = []) {
  const normalizedTargets = (targets || [])
    .map((t) => ({
      assetSymbol: normalizeSymbol(t?.assetSymbol),
      providerName: String(t?.providerName || '').trim().toLowerCase(),
      providerSymbol: String(t?.providerSymbol || '').trim().toUpperCase(),
    }))
    .filter((t) => t.assetSymbol && t.providerName && t.providerSymbol);

  if (normalizedTargets.length === 0) return {};

  const out = {};
  const missingByProvider = new Map(); // provider -> targets[]

  for (const t of normalizedTargets) {
    const key = `quote:crypto:${t.providerName}:${t.providerSymbol}`;
    const cached = marketDataCache.get(key);
    if (cached) {
      out[t.assetSymbol] = cached;
    } else {
      const list = missingByProvider.get(t.providerName) || [];
      list.push(t);
      missingByProvider.set(t.providerName, list);
    }
  }

  const providerFetches = Array.from(missingByProvider.entries()).map(async ([providerName, list]) => {
    const provider = cryptoProviders[providerName];
    if (!provider) return;
    const batchKey = inflightKey(
      `cryptoQuotes:${providerName}`,
      list.map((t) => t.providerSymbol).sort().join(','),
    );
    const fetched = await withInflight(batchKey, async () => provider.getQuotes(
      list.map((t) => ({ assetSymbol: t.assetSymbol, providerSymbol: t.providerSymbol }))
    ));
    for (const t of list) {
      const q = fetched?.[t.assetSymbol] || null;
      if (q) {
        marketDataCache.set(`quote:crypto:${providerName}:${t.providerSymbol}`, q);
        out[t.assetSymbol] = q;
      }
    }
  });

  await Promise.all(providerFetches);
  return out;
}

/**
 * Central FX fetch with per-currency caching (USD per 1 unit).
 * Returns a bundle compatible with existing callers.
 * @param {string[]} currencies
 * @returns {Promise<{ rates: Record<string, number>, providerLabel: string }>}
 */
export async function getLiveFxBundle(currencies = []) {
  const supported = filterToSupportedCurrencyCodes(currencies);
  const normalized = uniqueNonEmpty(supported, (c) => String(c || '').trim().toUpperCase())
    .filter((c) => c && c !== 'USD');

  // Keep old behavior: if provider isn't frankfurter, return empty rates.
  if (FX_PROVIDER !== 'frankfurter') {
    return { rates: {}, providerLabel: FX_PROVIDER || 'unknown' };
  }

  const rates = { USD: 1 };
  const missing = [];
  for (const code of normalized) {
    const key = `fx:usdPerUnit:${code}`;
    const cached = fxCache.get(key);
    if (cached && Number.isFinite(Number(cached)) && Number(cached) > 0) {
      const v = Number(cached);
      rates[code] = v;
      rememberFx(code, v);
    } else {
      missing.push(code);
    }
  }

  let providerLabel = 'frankfurter';

  if (missing.length > 0) {
    // 1) If we have last-known-good values for all missing currencies, return immediately (fast path),
    // and refresh asynchronously in the background.
    const staleResolved = [];
    const stillMissing = [];
    for (const code of missing) {
      const v = getLastGoodFx(code);
      if (v != null) {
        rates[code] = v;
        staleResolved.push(code);
      } else {
        stillMissing.push(code);
      }
    }

    if (stillMissing.length === 0 && staleResolved.length > 0) {
      providerLabel = 'cache-stale';
      const refreshKey = inflightKey('fxBundleRefresh', missing.sort().join(','));
      // Fire-and-forget refresh: do not block the request.
      void withInflight(refreshKey, async () => {
        const fetched = await fetchFxRatesWithFallback(missing, { disableFallback: fxFallbackDisabled() });
        const fetchedRates = fetched?.rates || {};
        for (const code of missing) {
          const v = Number(fetchedRates?.[code]);
          if (Number.isFinite(v) && v > 0) {
            fxCache.set(`fx:usdPerUnit:${code}`, v);
            rememberFx(code, v);
          }
        }
        return true;
      });
      return { rates, providerLabel };
    }

    // 2) Otherwise, fetch missing rates but cap how long we wait (avoid the 10s HTTP timeout stalling UI).
    const batchKey = inflightKey('fxBundle', missing.sort().join(','));
    const fetchPromise = withInflight(batchKey, async () => fetchFxRatesWithFallback(missing, {
      disableFallback: fxFallbackDisabled(),
    }));
    const timeoutMs = 1200;
    const fetched = await Promise.race([
      fetchPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!fetched) {
      providerLabel = Object.keys(rates).length > 1 ? 'cache-partial-timeout' : 'fx-timeout';
      return { rates, providerLabel };
    }

    const fetchedRates = fetched?.rates || {};
    providerLabel = Array.isArray(fetched?.providersUsed) ? fetched.providersUsed.join('+') : providerLabel;

    // Cache per currency for better reuse.
    for (const code of missing) {
      const v = Number(fetchedRates?.[code]);
      if (Number.isFinite(v) && v > 0) {
        fxCache.set(`fx:usdPerUnit:${code}`, v);
        rememberFx(code, v);
        rates[code] = v;
      }
    }
  }

  return { rates, providerLabel };
}

export async function getLiveFxRates(currencies = []) {
  const { rates } = await getLiveFxBundle(currencies);
  return rates;
}

/**
 * Warm FX cache in the background so the first interactive request after restart is fast.
 * Uses the underlying provider fetch (no short interactive cap).
 * @param {string[]} currencies
 */
export async function warmFxCache(currencies = []) {
  const supported = filterToSupportedCurrencyCodes(currencies);
  const normalized = uniqueNonEmpty(supported, (c) => String(c || '').trim().toUpperCase())
    .filter((c) => c && c !== 'USD');

  // Stablecoins are treated as USD in-app; FX providers won't return them.
  const toFetch = normalized.filter((c) => c !== 'USDT' && c !== 'USDC');
  if (toFetch.length === 0) return { ok: true, fetched: 0 };

  if (FX_PROVIDER !== 'frankfurter') {
    return { ok: false, fetched: 0, reason: 'FX_PROVIDER not frankfurter' };
  }

  const key = inflightKey('fxWarm', toFetch.sort().join(','));
  return withInflight(key, async () => {
    const fetched = await fetchFxRatesWithFallback(toFetch, {
      disableFallback: fxFallbackDisabled(),
    });
    const fetchedRates = fetched?.rates || {};
    let count = 0;
    for (const code of toFetch) {
      const v = Number(fetchedRates?.[code]);
      if (Number.isFinite(v) && v > 0) {
        fxCache.set(`fx:usdPerUnit:${code}`, v);
        rememberFx(code, v);
        count += 1;
      }
    }
    return { ok: true, fetched: count, providerLabel: Array.isArray(fetched?.providersUsed) ? fetched.providersUsed.join('+') : null };
  });
}

