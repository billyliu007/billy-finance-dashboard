const DEFAULT_CONFIG = {
  assets: [
    {
      key: 'btc',
      name: 'BTC',
      category: 'Crypto Assets',
      providerSymbols: {
        coinbase: 'BTC-USDT',
        coingecko: 'bitcoin',
        binance: 'BTCUSDT',
      },
    },
    {
      key: 'eth',
      name: 'ETH',
      category: 'Crypto Assets',
      providerSymbols: {
        coinbase: 'ETH-USDT',
        coingecko: 'ethereum',
        binance: 'ETHUSDT',
      },
    },
    {
      key: 'qqq',
      name: 'QQQ',
      category: 'Stock Assets',
      providerSymbols: {
        finnhub: 'QQQ',
      },
    },
    {
      key: 'qqqm',
      name: 'QQQM',
      category: 'Stock Assets',
      providerSymbols: {
        finnhub: 'QQQM',
      },
    },
    {
      key: 'tsla',
      name: 'TSLA',
      category: 'Stock Assets',
      providerSymbols: {
        finnhub: 'TSLA',
      },
    },
  ],
};

function parseJsonObject(raw) {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeConfig(userConfig) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  };

  if (!Array.isArray(merged.assets) || merged.assets.length === 0) {
    merged.assets = DEFAULT_CONFIG.assets;
  }

  return merged;
}

const PORTFOLIO_CONFIG = normalizeConfig(parseJsonObject(process.env.PORTFOLIO_CONFIG_JSON));

export default PORTFOLIO_CONFIG;
