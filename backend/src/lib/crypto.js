import { fetchWithTimeout } from './http.js';

const BINANCE_TICKER_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price';
const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const COINBASE_TICKER_BASE_URL = 'https://api.exchange.coinbase.com/products';
const COINBASE_CANDLES_BASE_URL = 'https://api.exchange.coinbase.com/products';
const CRYPTO_TIMEOUT_MS = 10000;

const COINBASE_REQUEST_HEADERS = {
  'User-Agent': 'billy-finance-dashboard/coinbase-ticker',
  Accept: 'application/json',
};

/** Fetch one Coinbase product ticker; returns parsed quote or null. */
async function fetchOneCoinbaseTicker(providerSymbol, assetSymbol, timeoutMs = CRYPTO_TIMEOUT_MS) {
  const response = await fetchWithTimeout(
    `${COINBASE_TICKER_BASE_URL}/${providerSymbol}/ticker`,
    { timeoutMs, headers: COINBASE_REQUEST_HEADERS }
  );
  if (!response.ok) return null;
  const body = await response.json();
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const timestamp = body?.time ? new Date(body.time).getTime() : Date.now();
  return {
    symbol: assetSymbol,
    pair: providerSymbol,
    price,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    source: 'coinbase',
  };
}

function normalizeTargets(targets = []) {
  return targets
    .map((target) => {
      const assetSymbol = String(target?.assetSymbol || '').trim().toUpperCase();
      const providerSymbol = String(target?.providerSymbol || '').trim();
      return {
        assetSymbol,
        providerSymbol,
      };
    })
    .filter((target) => target.assetSymbol && target.providerSymbol);
}

export async function fetchBinanceUsdtQuotes(targets = []) {
  const normalizedTargets = normalizeTargets(targets).map((target) => ({
    ...target,
    providerSymbol: target.providerSymbol.toUpperCase(),
  }));
  if (normalizedTargets.length === 0) {
    return {};
  }

  const requests = normalizedTargets.map(async (target) => {
    try {
      const params = new URLSearchParams({ symbol: target.providerSymbol });
      const response = await fetchWithTimeout(`${BINANCE_TICKER_PRICE_URL}?${params.toString()}`, {
        timeoutMs: CRYPTO_TIMEOUT_MS,
      });
      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      const price = Number(body?.price);
      if (!Number.isFinite(price) || price <= 0) {
        return null;
      }

      return {
        symbol: target.assetSymbol,
        pair: target.providerSymbol,
        price,
        timestamp: Date.now(),
        source: 'binance',
      };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(requests);
  return results.reduce((acc, item) => {
    if (item) {
      acc[item.symbol] = item;
    }
    return acc;
  }, {});
}

export async function fetchCoingeckoUsdQuotes(symbols = []) {
  const normalizedTargets = normalizeTargets(symbols).map((target) => ({
    ...target,
    providerSymbol: target.providerSymbol.toLowerCase(),
  }));
  if (normalizedTargets.length === 0) {
    return {};
  }

  const idToSymbol = new Map();
  normalizedTargets.forEach((target) => {
    idToSymbol.set(target.providerSymbol, target.assetSymbol);
  });

  const ids = Array.from(idToSymbol.keys());
  if (ids.length === 0) {
    return {};
  }

  try {
    const params = new URLSearchParams({
      ids: ids.join(','),
      vs_currencies: 'usd',
    });
    const response = await fetchWithTimeout(`${COINGECKO_SIMPLE_PRICE_URL}?${params.toString()}`, {
      timeoutMs: CRYPTO_TIMEOUT_MS,
    });
    if (!response.ok) {
      return {};
    }

    const body = await response.json();
    const timestamp = Date.now();
    return ids.reduce((acc, id) => {
      const symbol = idToSymbol.get(id);
      const price = Number(body?.[id]?.usd);
      if (symbol && Number.isFinite(price) && price > 0) {
        acc[symbol] = {
          symbol,
          pair: `${symbol}/USD`,
          price,
          timestamp,
          source: 'coingecko',
        };
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

/** Alternate quote currencies to try if the position's product (e.g. ADA-USDC) fails. */
const COINBASE_QUOTE_FALLBACKS = ['USDT', 'USDC', 'USD'];

export async function fetchCoinbaseProductQuotes(targets = []) {
  const normalizedTargets = normalizeTargets(targets).map((target) => ({
    ...target,
    providerSymbol: target.providerSymbol.toUpperCase(),
  }));
  if (normalizedTargets.length === 0) {
    return {};
  }

  const results = await Promise.all(
    normalizedTargets.map(async (target) => {
      const base = target.assetSymbol;
      const preferred = target.providerSymbol; // e.g. ADA-USDC
      try {
        let quote = await fetchOneCoinbaseTicker(preferred, base);
        if (quote) return quote;
        const preferredQuote = preferred.includes('-') ? preferred.split('-')[1] : '';
        for (const q of COINBASE_QUOTE_FALLBACKS) {
          if (q === preferredQuote) continue;
          const fallbackId = `${base}-${q}`;
          quote = await fetchOneCoinbaseTicker(fallbackId, base);
          if (quote) return quote;
        }
        return null;
      } catch {
        return null;
      }
    })
  );

  return results.reduce((acc, item) => {
    if (item) {
      acc[item.symbol] = item;
    }
    return acc;
  }, {});
}

/**
 * Fetch daily close candles for a Coinbase product.
 * @param {{ productId: string, fromDate: string, toDate: string }} options
 * @returns {Promise<Array<{ date: string, close: number }>>}
 */
export async function fetchCoinbaseDailyCloses({ productId, fromDate, toDate }) {
  const id = String(productId || '').trim().toUpperCase();
  if (!id || !fromDate || !toDate) return [];
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return [];

  try {
    const params = new URLSearchParams({
      granularity: '86400',
      start: start.toISOString(),
      end: end.toISOString(),
    });
    const response = await fetchWithTimeout(
      `${COINBASE_CANDLES_BASE_URL}/${id}/candles?${params.toString()}`,
      { timeoutMs: CRYPTO_TIMEOUT_MS, headers: COINBASE_REQUEST_HEADERS },
    );
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        const ts = Number(row?.[0]);
        const close = Number(row?.[4]);
        if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) return null;
        return { date: new Date(ts * 1000).toISOString().slice(0, 10), close };
      })
      .filter(Boolean)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch {
    return [];
  }
}
