import { createHmac } from 'node:crypto';

/**
 * Minimal read-only Binance (binance.com) client for exchange sync.
 * Supports system-generated (HMAC-SHA256) API keys only.
 */

export class ExchangeError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'ExchangeError';
    this.code = code;
    this.statusCode = status;
  }
}

// BINANCE_API_BASE_URL lets local development point at a mock server.
const BASE_URL = 'https://api.binance.com';
const TIMEOUT_MS = 15000;

export function signQuery(queryString, secret) {
  return createHmac('sha256', secret).update(queryString).digest('hex');
}

function mapError(status, body) {
  const code = Number(body?.code);
  const msg = String(body?.msg || '').slice(0, 200);
  if (status === 451 || /restricted location/i.test(msg)) {
    return new ExchangeError('Binance refuses requests from this server\'s location.', 'restricted_location', 502);
  }
  if (code === -2015 || code === -2014 || code === -2008 || code === -1022) {
    return new ExchangeError(
      'Binance rejected the API key. Check the key and secret, that it is a system-generated (HMAC) key, and any IP restriction.',
      'invalid_key',
    );
  }
  if (code === -1021) {
    return new ExchangeError('Binance rejected the request time. Try again.', 'clock_skew', 502);
  }
  if (code === -1121) return new ExchangeError('Invalid symbol.', 'invalid_symbol');
  if (status === 429 || status === 418) {
    return new ExchangeError('Binance rate limit reached. Try again in a minute.', 'rate_limited', 503);
  }
  return new ExchangeError(`Binance error${msg ? `: ${msg}` : ` (HTTP ${status})`}.`, 'exchange_error', 502);
}

/**
 * @param {{ apiKey: string, apiSecret: string, fetchImpl?: typeof fetch, baseUrl?: string, now?: () => number }} opts
 */
export function createBinanceClient({
  apiKey,
  apiSecret,
  fetchImpl = fetch,
  baseUrl = process.env.BINANCE_API_BASE_URL || BASE_URL,
  now = () => Date.now(),
}) {
  async function request(path, params = {}, { signed = true } = {}) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
    }
    if (signed) {
      search.set('recvWindow', '10000');
      search.set('timestamp', String(now()));
      search.set('signature', signQuery(search.toString(), apiSecret));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}?${search.toString()}`, {
        headers: signed ? { 'X-MBX-APIKEY': apiKey } : {},
        signal: controller.signal,
      });
    } catch (error) {
      throw new ExchangeError(
        error?.name === 'AbortError' ? 'Binance did not answer in time.' : 'Could not reach Binance.',
        'network_error',
        502,
      );
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw mapError(response.status, body);
    return body;
  }

  return {
    /** Key permissions: { enableReading, enableSpotAndMarginTrading, enableWithdrawals, ... }. */
    getApiRestrictions: () => request('/sapi/v1/account/apiRestrictions'),
    /** Non-zero spot balances: [{ asset, free, locked }]. */
    async getBalances() {
      const body = await request('/api/v3/account', { omitZeroBalances: 'true' });
      return Array.isArray(body?.balances) ? body.balances : [];
    },
    /** Latest fills for one pair (newest 1000). Optional time window must be ≤ 24h. */
    getMyTrades: (symbol, { startTime, endTime, limit = 1000 } = {}) =>
      request('/api/v3/myTrades', { symbol, startTime, endTime, limit }),
    async getConvertTrades(startTime, endTime) {
      const body = await request('/sapi/v1/convert/tradeFlow', { startTime, endTime, limit: 1000 });
      return Array.isArray(body?.list) ? body.list : [];
    },
    async getAutoInvestHistory(startTime, endTime) {
      const body = await request('/sapi/v1/lending/auto-invest/history/list', { startTime, endTime, size: 100 });
      if (Array.isArray(body)) return body;
      return Array.isArray(body?.list) ? body.list : [];
    },
    /** Public last price for a pair, or null. */
    async getPrice(symbol) {
      try {
        const body = await request('/api/v3/ticker/price', { symbol }, { signed: false });
        const price = Number(body?.price);
        return Number.isFinite(price) && price > 0 ? price : null;
      } catch {
        return null;
      }
    },
  };
}

/** Permissions a read-only key must not have. */
export const BINANCE_FORBIDDEN_PERMISSIONS = [
  'enableSpotAndMarginTrading',
  'enableWithdrawals',
  'enableInternalTransfer',
  'permitsUniversalTransfer',
  'enableMargin',
  'enableFutures',
  'enableVanillaOptions',
  'enablePortfolioMarginTrading',
  'enableFixApiTrade',
];

const PERMISSION_LABELS = {
  enableSpotAndMarginTrading: 'spot and margin trading',
  enableWithdrawals: 'withdrawals',
  enableInternalTransfer: 'internal transfers',
  permitsUniversalTransfer: 'universal transfers',
  enableMargin: 'margin',
  enableFutures: 'futures',
  enableVanillaOptions: 'options',
  enablePortfolioMarginTrading: 'portfolio margin',
  enableFixApiTrade: 'FIX API trading',
};

/** Throws unless the key can read and can do nothing else. */
export function assertReadOnlyBinanceKey(restrictions) {
  if (!restrictions || restrictions.enableReading !== true) {
    throw new ExchangeError('This key cannot read account data. Tick "Enable Reading" on Binance.', 'not_readable');
  }
  const extra = BINANCE_FORBIDDEN_PERMISSIONS.filter((k) => restrictions[k] === true);
  if (extra.length > 0) {
    throw new ExchangeError(
      `For safety, use a read-only key. This key also allows ${extra.map((k) => PERMISSION_LABELS[k] || k).join(', ')}. Create a new key with only "Enable Reading" ticked.`,
      'key_not_read_only',
    );
  }
}
