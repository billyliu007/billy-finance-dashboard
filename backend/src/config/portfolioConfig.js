const DEFAULT_CONFIG = {
  range: "'Crypto/Stock Portfolio'!A1:Z400",
  assets: [
    {
      key: 'btc',
      name: 'BTC',
      category: 'Crypto Assets',
      qtyCell: 'D28',
      purchasePriceCell: 'C28',
      currentPriceCell: 'F28',
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
      qtyCell: 'D36',
      purchasePriceCell: 'C36',
      currentPriceCell: 'F36',
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
      qtyCell: 'D40',
      purchasePriceCell: 'C40',
      currentPriceCell: 'F39',
      providerSymbols: {
        finnhub: 'QQQ',
      },
    },
    {
      key: 'qqqm',
      name: 'QQQM',
      category: 'Stock Assets',
      qtyCell: 'D46',
      purchasePriceCell: 'C46',
      currentPriceCell: 'F45',
      providerSymbols: {
        finnhub: 'QQQM',
      },
    },
    {
      key: 'tsla',
      name: 'TSLA',
      category: 'Stock Assets',
      qtyCell: 'D43',
      purchasePriceCell: 'C43',
      currentPriceCell: 'F42',
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

  if (typeof merged.range !== 'string' || merged.range.trim() === '') {
    merged.range = DEFAULT_CONFIG.range;
  }

  return merged;
}

const PORTFOLIO_CONFIG = normalizeConfig(parseJsonObject(process.env.PORTFOLIO_CONFIG_JSON));

export default PORTFOLIO_CONFIG;
