import { stockProviders, cryptoProviders } from '../lib/marketDataProviders.js';
import {
  getCryptoQuotes,
  getLiveFxBundle,
  getLiveFxRates as getFxRates,
  getStockQuotes,
  isFxFallbackDisabled,
} from './pricingGateway.js';

const CRYPTO_PROVIDER = String(process.env.CRYPTO_PROVIDER || 'coinbase').trim().toLowerCase();

function isStock(position) {
  return /stock/i.test(String(position?.category || ''));
}

function isCrypto(position) {
  return /crypto/i.test(String(position?.category || ''));
}

function toStockTargets(positions) {
  const seen = new Set();
  const targets = [];
  for (const position of positions || []) {
    if (!isStock(position)) continue;
    const symbol = String(position.symbol || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    targets.push({
      assetSymbol: symbol,
      providerSymbol: symbol,
    });
  }
  return targets;
}

export async function getStockQuoteMapForPositions(positions) {
  const stockTargets = toStockTargets(positions);
  return getStockQuotes(stockTargets.map((t) => t.assetSymbol));
}

export async function getCryptoQuoteMapForPositions(positions) {
  const targetsByProvider = {};
  
  for (const position of positions || []) {
    if (!isCrypto(position)) continue;
    const symbol = String(position.symbol || '').trim().toUpperCase();
    const providerStr = String(position.marketProvider || '').trim().toLowerCase();
    const instrumentId = String(position.marketInstrumentId || '').trim().toUpperCase();
    if (!symbol || !providerStr || !instrumentId) continue;
    
    if (!targetsByProvider[providerStr]) {
       targetsByProvider[providerStr] = new Map();
    }
    targetsByProvider[providerStr].set(`${symbol}:${instrumentId}`, {
      assetSymbol: symbol,
      providerName: providerStr,
      providerSymbol: instrumentId,
    });
  }

  const flattened = Object.values(targetsByProvider).flatMap((m) => Array.from(m.values()));
  return getCryptoQuotes(flattened);
}

/**
 * Live FX map (USD per 1 unit). Frankfurter first; merges open.er-api when defaults + cash currencies are incomplete.
 * @returns {Promise<{ rates: Record<string, number>, providerLabel: string }>}
 */
export async function resolveLiveFxRates(currenciesFromCash = []) {
  // Keep legacy compatibility: return { rates, providerLabel }.
  // pricingGateway already respects FX_PROVIDER and FX_PROVIDER_FALLBACK.
  return getLiveFxBundle(currenciesFromCash);
}

export async function getLiveFxRates(currenciesFromCash = []) {
  // Expose rates-only helper for existing call sites.
  return getFxRates(currenciesFromCash);
}

/** Matches {@link resolveLiveFxRates} fallback toggle (for CNY patch in snapshots). */
export function isFxProviderFallbackEnabled() {
  return !isFxFallbackDisabled();
}

export async function getBenchmarkQuotes() {
  const stockProvider = stockProviders['finnhub'];
  const cryptoProvider = cryptoProviders['coinbase'];
  
  const [stockQuotes, cryptoQuotes] = await Promise.all([
    stockProvider ? stockProvider.getQuotes([{ assetSymbol: 'SPY', providerSymbol: 'SPY' }]) : {},
    cryptoProvider ? cryptoProvider.getQuotes([{ assetSymbol: 'BTC', providerSymbol: 'BTC-USD' }]) : {},
  ]);

  const spyQuote = stockQuotes?.SPY;
  const btcQuote = cryptoQuotes?.BTC;

  return {
    spy: spyQuote && Number.isFinite(spyQuote.price)
        ? { symbol: 'SPY', price: spyQuote.price, changePct: spyQuote.changePct ?? null }
        : null,
    btc: btcQuote && Number.isFinite(btcQuote.price)
        ? { symbol: 'BTC', price: btcQuote.price, changePct: btcQuote.changePct ?? null }
        : null,
  };
}

export async function getBenchmarkHistory({ fromDate, toDate }) {
  const stockProvider = stockProviders['finnhub'];
  const cryptoProvider = cryptoProviders['coinbase'];
  
  const [spy, btc] = await Promise.all([
    stockProvider ? stockProvider.getDailyCloses({ target: { providerSymbol: 'SPY' }, fromDate, toDate }) : [],
    cryptoProvider ? cryptoProvider.getDailyCloses({ target: { providerSymbol: 'BTC-USD' }, fromDate, toDate }) : [],
  ]);
  
  return { spy, btc };
}

export async function buildProviderDiagnosticsForPositions(positions) {
  // Fetch a stable baseline set so diagnostics don't false-fail when called with no cash currencies.
  const fxDiagnosticsCurrencies = ['CNY', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];
  const [stockQuotes, cryptoQuotes, { rates: fxRates, providerLabel: fxProviderLabel }] = await Promise.all([
    getStockQuoteMapForPositions(positions),
    getCryptoQuoteMapForPositions(positions),
    resolveLiveFxRates(fxDiagnosticsCurrencies),
  ]);
  return [
    {
      provider: 'finnhub',
      status: Object.keys(stockQuotes).length > 0 ? 'ok' : 'error',
      message: Object.keys(stockQuotes).length > 0
          ? `Live stock quotes received (${Object.keys(stockQuotes).length}).`
          : 'No live stock quotes received from Finnhub.',
      checkedAt: new Date().toISOString(),
    },
    {
      provider: CRYPTO_PROVIDER,
      status: Object.keys(cryptoQuotes).length > 0 ? 'ok' : 'error',
      message: Object.keys(cryptoQuotes).length > 0
          ? `Live crypto quotes received (${Object.keys(cryptoQuotes).length}).`
          : 'No live crypto quotes received.',
      checkedAt: new Date().toISOString(),
    },
    {
      provider: fxProviderLabel,
      status: Number.isFinite(fxRates.USD) && Number.isFinite(fxRates.SGD) ? 'ok' : 'error',
      message: Number.isFinite(fxRates.USD) && Number.isFinite(fxRates.SGD)
          ? `Live FX rates received (${fxProviderLabel}).`
          : 'Live FX rates unavailable.',
      checkedAt: new Date().toISOString(),
    },
  ];
}
