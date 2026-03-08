const BINANCE_TICKER_PRICE_URL = 'https://api.binance.com/api/v3/ticker/price';
const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const COINBASE_TICKER_BASE_URL = 'https://api.exchange.coinbase.com/products';

function normalizeTargets(targets = []) {
  return targets
    .map((target) => {
      const assetSymbol = String(target?.assetSymbol || '').trim().toUpperCase();
      const providerSymbol = String(target?.providerSymbol || '').trim();
      return {
        assetSymbol,
        providerSymbol,
      };
    })
    .filter((target) => target.assetSymbol && target.providerSymbol);
}

export async function fetchBinanceUsdtQuotes(targets = []) {
  const normalizedTargets = normalizeTargets(targets).map((target) => ({
    ...target,
    providerSymbol: target.providerSymbol.toUpperCase(),
  }));
  if (normalizedTargets.length === 0) {
    return {};
  }

  const requests = normalizedTargets.map(async (target) => {
    try {
      const params = new URLSearchParams({ symbol: target.providerSymbol });
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
        symbol: target.assetSymbol,
        pair: target.providerSymbol,
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
  const normalizedTargets = normalizeTargets(symbols).map((target) => ({
    ...target,
    providerSymbol: target.providerSymbol.toLowerCase(),
  }));
  if (normalizedTargets.length === 0) {
    return {};
  }

  const idToSymbol = new Map();
  normalizedTargets.forEach((target) => {
    idToSymbol.set(target.providerSymbol, target.assetSymbol);
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

export async function fetchCoinbaseProductQuotes(targets = []) {
  const normalizedTargets = normalizeTargets(targets).map((target) => ({
    ...target,
    providerSymbol: target.providerSymbol.toUpperCase(),
  }));
  if (normalizedTargets.length === 0) {
    return {};
  }

  const requests = normalizedTargets.map(async (target) => {
    try {
      const response = await fetch(`${COINBASE_TICKER_BASE_URL}/${target.providerSymbol}/ticker`);
      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      const price = Number(body?.price);
      if (!Number.isFinite(price) || price <= 0) {
        return null;
      }

      const timestamp = body?.time ? new Date(body.time).getTime() : Date.now();
      return {
        symbol: target.assetSymbol,
        pair: target.providerSymbol,
        price,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        source: 'coinbase',
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
