const BINANCE_TICKER_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price';

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
