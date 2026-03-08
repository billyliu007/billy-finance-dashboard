const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';

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

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    symbol,
    price,
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

  const requests = normalizedSymbols.map(async (symbol) => {
    try {
      const params = new URLSearchParams({ symbol, token: apiKey });
      const response = await fetch(`${FINNHUB_QUOTE_URL}?${params.toString()}`);
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
  return results.reduce((acc, item) => {
    if (item) {
      acc[item.symbol] = item;
    }
    return acc;
  }, {});
}
