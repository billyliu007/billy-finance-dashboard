import PORTFOLIO_CONFIG from '../config/portfolioConfig.js';
import { fetchFinnhubQuotes } from '../lib/finnhub.js';
import { fetchFrankfurterFxRates } from '../lib/fx.js';
import { fetchBinanceUsdtQuotes, fetchCoingeckoUsdQuotes, fetchCoinbaseProductQuotes } from '../lib/crypto.js';

const FX_PROVIDER = String(process.env.FX_PROVIDER || 'frankfurter').trim().toLowerCase();
const CRYPTO_PROVIDER = String(process.env.CRYPTO_PROVIDER || 'coinbase').trim().toLowerCase();

function getAssetConfigMap() {
  return new Map(
    (PORTFOLIO_CONFIG.assets || []).map((asset) => [String(asset.name || '').trim().toUpperCase(), asset]),
  );
}

function isStock(position) {
  return /stock/i.test(String(position?.category || ''));
}

function isCrypto(position) {
  return /crypto/i.test(String(position?.category || ''));
}

function mapCryptoTargets(assets, provider) {
  if (provider === 'coinbase') {
    return assets.map((asset) => ({
      assetSymbol: asset.assetSymbol,
      providerSymbol: asset.coinbaseProduct,
    }));
  }
  if (provider === 'coingecko') {
    return assets
      .filter((asset) => asset.coingeckoId)
      .map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.coingeckoId,
      }));
  }
  if (provider === 'binance') {
    return assets.map((asset) => ({
      assetSymbol: asset.assetSymbol,
      providerSymbol: asset.binanceSymbol,
    }));
  }
  return [];
}

function findMissingAssets(assets, quotes) {
  return assets.filter((asset) => !quotes[asset.assetSymbol]);
}

function mergeQuotesByPriority(highPriorityToLowPriority) {
  return highPriorityToLowPriority.reduceRight((acc, quoteMap) => ({ ...acc, ...quoteMap }), {});
}

function toStockTargets(positions) {
  const seen = new Set();
  const targets = [];
  const assetMap = getAssetConfigMap();
  for (const position of positions || []) {
    if (!isStock(position)) continue;
    const symbol = String(position.symbol || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const configured = assetMap.get(symbol);
    targets.push({
      assetSymbol: symbol,
      providerSymbol: String(configured?.providerSymbols?.finnhub || symbol).toUpperCase(),
    });
  }
  return targets;
}

function toCryptoAssets(positions) {
  const seen = new Set();
  const assets = [];
  const assetMap = getAssetConfigMap();
  for (const position of positions || []) {
    if (!isCrypto(position)) continue;
    const symbol = String(position.symbol || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const configured = assetMap.get(symbol);
    assets.push({
      assetSymbol: symbol,
      coinbaseProduct: String(configured?.providerSymbols?.coinbase || `${symbol}-USDT`).toUpperCase(),
      coingeckoId: String(configured?.providerSymbols?.coingecko || '').toLowerCase(),
      binanceSymbol: String(configured?.providerSymbols?.binance || `${symbol}USDT`).toUpperCase(),
    });
  }
  return assets;
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
  const cryptoAssets = toCryptoAssets(positions);
  if (cryptoAssets.length === 0) {
    return {};
  }
  if (CRYPTO_PROVIDER === 'binance') {
    return fetchBinanceUsdtQuotes(mapCryptoTargets(cryptoAssets, 'binance'));
  }
  if (CRYPTO_PROVIDER === 'coingecko') {
    const coingeckoQuotes = await fetchCoingeckoUsdQuotes(mapCryptoTargets(cryptoAssets, 'coingecko'));
    const missing = findMissingAssets(cryptoAssets, coingeckoQuotes);
    if (missing.length === 0) return coingeckoQuotes;
    const binanceQuotes = await fetchBinanceUsdtQuotes(mapCryptoTargets(missing, 'binance'));
    return mergeQuotesByPriority([coingeckoQuotes, binanceQuotes]);
  }

  const coinbaseQuotes = await fetchCoinbaseProductQuotes(mapCryptoTargets(cryptoAssets, 'coinbase'));
  const missingAfterCoinbase = findMissingAssets(cryptoAssets, coinbaseQuotes);
  if (missingAfterCoinbase.length === 0) {
    return coinbaseQuotes;
  }
  const coingeckoQuotes = await fetchCoingeckoUsdQuotes(mapCryptoTargets(missingAfterCoinbase, 'coingecko'));
  const missingAfterCoingecko = findMissingAssets(missingAfterCoinbase, coingeckoQuotes);
  if (missingAfterCoingecko.length === 0) {
    return mergeQuotesByPriority([coinbaseQuotes, coingeckoQuotes]);
  }
  const binanceQuotes = await fetchBinanceUsdtQuotes(mapCryptoTargets(missingAfterCoingecko, 'binance'));
  return mergeQuotesByPriority([coinbaseQuotes, coingeckoQuotes, binanceQuotes]);
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
