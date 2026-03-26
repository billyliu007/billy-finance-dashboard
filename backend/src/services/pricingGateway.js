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
      rates[code] = Number(cached);
    } else {
      missing.push(code);
    }
  }

  let providerLabel = 'frankfurter';

  if (missing.length > 0) {
    const batchKey = inflightKey('fxBundle', missing.sort().join(','));
    const fetched = await withInflight(batchKey, async () => fetchFxRatesWithFallback(missing, {
      disableFallback: fxFallbackDisabled(),
    }));
    const fetchedRates = fetched?.rates || {};
    providerLabel = Array.isArray(fetched?.providersUsed) ? fetched.providersUsed.join('+') : providerLabel;

    // Cache per currency for better reuse.
    for (const code of missing) {
      const v = Number(fetchedRates?.[code]);
      if (Number.isFinite(v) && v > 0) {
        fxCache.set(`fx:usdPerUnit:${code}`, v);
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

