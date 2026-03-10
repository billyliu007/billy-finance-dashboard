import { fetchFinnhubQuotes } from '../lib/finnhub.js';
import { fetchFrankfurterFxRates } from '../lib/fx.js';
import { fetchBinanceUsdtQuotes, fetchCoingeckoUsdQuotes, fetchCoinbaseProductQuotes } from '../lib/crypto.js';

const FX_PROVIDER = String(process.env.FX_PROVIDER || 'frankfurter').trim().toLowerCase();
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
  if (!process.env.FINNHUB_API_KEY || stockTargets.length === 0) {
    return {};
  }
  const rawQuotes = await fetchFinnhubQuotes(stockTargets.map((target) => target.providerSymbol));
  return stockTargets.reduce((acc, target) => {
    const quote = rawQuotes[target.providerSymbol];
    if (quote) {
      acc[target.assetSymbol] = { ...quote, symbol: target.assetSymbol };
    }
    return acc;
  }, {});
}

export async function getCryptoQuoteMapForPositions(positions) {
  const seen = new Set();
  const coinbaseTargets = [];

  for (const position of positions || []) {
    if (!isCrypto(position)) continue;
    const symbol = String(position.symbol || '').trim().toUpperCase();
    const provider = String(position.marketProvider || '').trim().toLowerCase();
    const instrumentId = String(position.marketInstrumentId || '').trim().toUpperCase();
    if (!symbol || !provider || !instrumentId) continue;
    const key = `${provider}:${instrumentId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (provider === 'coinbase') {
      coinbaseTargets.push({
        assetSymbol: symbol,
        providerSymbol: instrumentId,
      });
    }
  }

  const quotes = {};

  if (coinbaseTargets.length > 0) {
    const coinbaseQuotes = await fetchCoinbaseProductQuotes(coinbaseTargets);
    Object.assign(quotes, coinbaseQuotes);
  }

  return quotes;
}

export async function getLiveFxRates() {
  if (FX_PROVIDER === 'frankfurter') {
    return fetchFrankfurterFxRates();
  }
  return {};
}

export async function buildProviderDiagnosticsForPositions(positions) {
  const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
    getStockQuoteMapForPositions(positions),
    getCryptoQuoteMapForPositions(positions),
    getLiveFxRates(),
  ]);
  return [
    {
      provider: 'finnhub',
      status: Object.keys(stockQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(stockQuotes).length > 0
          ? `Live stock quotes received (${Object.keys(stockQuotes).length}).`
          : 'No live stock quotes received from Finnhub.',
      checkedAt: new Date().toISOString(),
    },
    {
      provider: CRYPTO_PROVIDER,
      status: Object.keys(cryptoQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(cryptoQuotes).length > 0
          ? `Live crypto quotes received (${Object.keys(cryptoQuotes).length}).`
          : 'No live crypto quotes received.',
      checkedAt: new Date().toISOString(),
    },
    {
      provider: FX_PROVIDER,
      status: Number.isFinite(fxRates.USD) && Number.isFinite(fxRates.SGD) ? 'ok' : 'error',
      message:
        Number.isFinite(fxRates.USD) && Number.isFinite(fxRates.SGD)
          ? 'Live FX rates received for USD/CNY and SGD/CNY.'
          : 'Live FX rates unavailable.',
      checkedAt: new Date().toISOString(),
    },
  ];
}
