import { fetchWithTimeout } from './http.js';
import { marketDataCache } from './ttlCache.js';

const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';
const FINNHUB_CANDLE_URL = 'https://finnhub.io/api/v1/stock/candle';
const FINNHUB_TIMEOUT_MS = 10000;

function toSymbolList(symbols = []) {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter((symbol) => symbol.length > 0),
    ),
  );
}

function toQuoteResult(symbol, body) {
  const price = Number(body?.c);
  const timestampSeconds = Number(body?.t);
  const changePct = body?.dp != null && Number.isFinite(Number(body.dp)) ? Number(body.dp) : null;

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    symbol,
    price,
    changePct,
    timestamp: Number.isFinite(timestampSeconds) && timestampSeconds > 0 ? timestampSeconds * 1000 : null,
    source: 'finnhub',
  };
}

export async function fetchFinnhubQuotes(symbols = []) {
  const apiKey = String(process.env.FINNHUB_API_KEY || '').trim();
  if (!apiKey) {
    return {};
  }

  const normalizedSymbols = toSymbolList(symbols);
  if (normalizedSymbols.length === 0) {
    return {};
  }

  const cacheKey = `finnhub:quotes:${normalizedSymbols.sort().join(',')}`;
  const cached = marketDataCache.get(cacheKey);
  if (cached) return cached;

  const requests = normalizedSymbols.map(async (symbol) => {
    try {
      const params = new URLSearchParams({ symbol, token: apiKey });
      const response = await fetchWithTimeout(`${FINNHUB_QUOTE_URL}?${params.toString()}`, {
        timeoutMs: FINNHUB_TIMEOUT_MS,
      });
      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      return toQuoteResult(symbol, body);
    } catch {
      return null;
    }
  });

  const results = await Promise.all(requests);
  const data = results.reduce((acc, item) => {
    if (item) {
      acc[item.symbol] = item;
    }
    return acc;
  }, {});

  marketDataCache.set(cacheKey, data);
  return data;
}

/**
 * Fetch daily close prices from Finnhub for one symbol.
 * @param {{ symbol: string, fromDate: string, toDate: string }} options
 * @returns {Promise<Array<{ date: string, close: number }>>}
 */
export async function fetchFinnhubDailyCloses({ symbol, fromDate, toDate }) {
  const apiKey = String(process.env.FINNHUB_API_KEY || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!apiKey || !sym || !fromDate || !toDate) return [];

  const cacheKey = `finnhub:daily:${sym}:${fromDate}:${toDate}`;
  const cached = marketDataCache.get(cacheKey);
  if (cached) return cached;

  const fromTs = Math.floor(new Date(`${fromDate}T00:00:00.000Z`).getTime() / 1000);
  const toTs = Math.floor(new Date(`${toDate}T23:59:59.999Z`).getTime() / 1000);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs >= toTs) return [];

  try {
    const params = new URLSearchParams({
      symbol: sym,
      resolution: 'D',
      from: String(fromTs),
      to: String(toTs),
      token: apiKey,
    });
    const response = await fetchWithTimeout(`${FINNHUB_CANDLE_URL}?${params.toString()}`, {
      timeoutMs: FINNHUB_TIMEOUT_MS,
    });
    if (!response.ok) return [];
    const body = await response.json();
    if (body?.s !== 'ok' || !Array.isArray(body?.t) || !Array.isArray(body?.c)) return [];

    const out = [];
    for (let i = 0; i < body.t.length; i += 1) {
      const ts = Number(body.t[i]);
      const close = Number(body.c[i]);
      if (!Number.isFinite(ts) || !Number.isFinite(close) || close <= 0) continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      out.push({ date, close });
    }
    marketDataCache.set(cacheKey, out, 3600000); // cache daily candles for 1 hour
    return out;
  } catch {
    return [];
  }
}
