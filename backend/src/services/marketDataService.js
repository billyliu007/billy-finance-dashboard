import { fetchFxRatesWithFallback } from '../lib/fx.js';
import { stockProviders, cryptoProviders } from '../lib/marketDataProviders.js';
import { filterToSupportedCurrencyCodes } from '../lib/supportedCurrencies.js';

const FX_PROVIDER = String(process.env.FX_PROVIDER || 'frankfurter').trim().toLowerCase();
/** Set to `none`, `off`, or `false` to use Frankfurter only. Any other value keeps secondary FX enabled. */
const FX_PROVIDER_FALLBACK = String(process.env.FX_PROVIDER_FALLBACK ?? 'open.er-api').trim().toLowerCase();
const CRYPTO_PROVIDER = String(process.env.CRYPTO_PROVIDER || 'coinbase').trim().toLowerCase();

function fxFallbackDisabled() {
  return ['none', 'off', 'false'].includes(FX_PROVIDER_FALLBACK);
}

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
  const provider = stockProviders['finnhub']; // Or dynamically load from env if needed
  if (!provider) return {};
  return provider.getQuotes(stockTargets);
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
      providerSymbol: instrumentId,
    });
  }

  const allQuotes = {};
  for (const [providerName, targetMap] of Object.entries(targetsByProvider)) {
    const provider = cryptoProviders[providerName];
    if (provider) {
      const targets = Array.from(targetMap.values());
      const quotes = await provider.getQuotes(targets);
      Object.assign(allQuotes, quotes);
    }
  }

  return allQuotes;
}

/**
 * Live FX map (USD per 1 unit). Frankfurter first; merges open.er-api when defaults + cash currencies are incomplete.
 * @returns {Promise<{ rates: Record<string, number>, providerLabel: string }>}
 */
export async function resolveLiveFxRates(currenciesFromCash = []) {
  const supported = filterToSupportedCurrencyCodes(currenciesFromCash);
  const normalized = supported.filter((c) => c && c !== 'CNY');

  if (FX_PROVIDER !== 'frankfurter') {
    return { rates: {}, providerLabel: FX_PROVIDER || 'unknown' };
  }

  const { rates, providersUsed } = await fetchFxRatesWithFallback(normalized, {
    disableFallback: fxFallbackDisabled(),
  });

  return { rates, providerLabel: providersUsed.join('+') };
}

export async function getLiveFxRates(currenciesFromCash = []) {
  const { rates } = await resolveLiveFxRates(currenciesFromCash);
  return rates;
}

/** Matches {@link resolveLiveFxRates} fallback toggle (for CNY patch in snapshots). */
export function isFxProviderFallbackEnabled() {
  return !fxFallbackDisabled();
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
  const [stockQuotes, cryptoQuotes, { rates: fxRates, providerLabel: fxProviderLabel }] = await Promise.all([
    getStockQuoteMapForPositions(positions),
    getCryptoQuoteMapForPositions(positions),
    resolveLiveFxRates(),
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
