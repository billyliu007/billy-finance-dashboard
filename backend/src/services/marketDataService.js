import { fetchFinnhubDailyCloses, fetchFinnhubQuotes } from '../lib/finnhub.js';
import { fetchFrankfurterFxRates } from '../lib/fx.js';
import { fetchCoinbaseDailyCloses, fetchCoinbaseProductQuotes } from '../lib/crypto.js';

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

/**
 * Fetch FX rates to CNY. Optionally pass currencies from cash components so all used currencies get a rate.
 * @param {string[]} [currenciesFromCash] - e.g. ['USD', 'SGD', 'EUR'] from user's cash rows
 */
export async function getLiveFxRates(currenciesFromCash = []) {
  if (FX_PROVIDER === 'frankfurter') {
    const normalized = (currenciesFromCash || [])
      .map((c) => String(c || '').trim().toUpperCase())
      .filter((c) => c && c !== 'CNY');
    return fetchFrankfurterFxRates(normalized);
  }
  return {};
}

/**
 * Fetch SPY (stock) and BTC (crypto) quotes for benchmark comparison.
 * @returns {Promise<{ spy: { symbol: string, price: number, changePct: number | null } | null, btc: { symbol: string, price: number, changePct: number | null } | null }>}
 */
export async function getBenchmarkQuotes() {
  const [stockQuotes, cryptoQuotes] = await Promise.all([
    getStockQuoteMapForPositions([{ symbol: 'SPY', category: 'US Stock Assets' }]),
    fetchCoinbaseProductQuotes([{ assetSymbol: 'BTC', providerSymbol: 'BTC-USD' }]),
  ]);

  const spyQuote = stockQuotes?.SPY;
  const btcQuote = cryptoQuotes?.BTC;

  return {
    spy:
      spyQuote && Number.isFinite(spyQuote.price)
        ? {
            symbol: 'SPY',
            price: spyQuote.price,
            changePct: spyQuote.changePct ?? null,
          }
        : null,
    btc:
      btcQuote && Number.isFinite(btcQuote.price)
        ? {
            symbol: 'BTC',
            price: btcQuote.price,
            changePct: btcQuote.changePct ?? null,
          }
        : null,
  };
}

/**
 * Fetch benchmark daily closes for SPY and BTC across a date range.
 * @param {{ fromDate: string, toDate: string }} options
 * @returns {Promise<{ spy: Array<{date:string, close:number}>, btc: Array<{date:string, close:number}> }>}
 */
export async function getBenchmarkHistory({ fromDate, toDate }) {
  const [spy, btc] = await Promise.all([
    fetchFinnhubDailyCloses({ symbol: 'SPY', fromDate, toDate }),
    fetchCoinbaseDailyCloses({ productId: 'BTC-USD', fromDate, toDate }),
  ]);
  return { spy, btc };
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
