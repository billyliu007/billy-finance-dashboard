const BINANCE_TICKER_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price';
const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

const COINGECKO_ID_BY_SYMBOL = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
};

function toSymbolList(symbols = []) {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter((symbol) => symbol.length > 0),
    ),
  );
}

export async function fetchBinanceUsdtQuotes(symbols = []) {
  const normalizedSymbols = toSymbolList(symbols);
  if (normalizedSymbols.length === 0) {
    return {};
  }

  const requests = normalizedSymbols.map(async (symbol) => {
    try {
      const pair = `${symbol}USDT`;
      const params = new URLSearchParams({ symbol: pair });
      const response = await fetch(`${BINANCE_TICKER_PRICE_URL}?${params.toString()}`);
      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      const price = Number(body?.price);
      if (!Number.isFinite(price) || price <= 0) {
        return null;
      }

      return {
        symbol,
        pair,
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
  const normalizedSymbols = toSymbolList(symbols);
  if (normalizedSymbols.length === 0) {
    return {};
  }

  const idToSymbol = new Map();
  normalizedSymbols.forEach((symbol) => {
    const coinId = COINGECKO_ID_BY_SYMBOL[symbol];
    if (coinId) {
      idToSymbol.set(coinId, symbol);
    }
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
    const response = await fetch(`${COINGECKO_SIMPLE_PRICE_URL}?${params.toString()}`);
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
