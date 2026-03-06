import { parseJsonObject } from './utils/config';

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
    },
    {
      key: 'eth',
      name: 'ETH',
      category: 'Crypto Assets',
      qtyCell: 'D36',
      purchasePriceCell: 'C36',
      currentPriceCell: 'F36',
    },
    {
      key: 'qqq',
      name: 'QQQ',
      category: 'Stock Assets',
      qtyCell: 'D40',
      purchasePriceCell: 'C40',
      currentPriceCell: 'F39',
    },
    {
      key: 'qqqm',
      name: 'QQQM',
      category: 'Stock Assets',
      qtyCell: 'D46',
      purchasePriceCell: 'C46',
      currentPriceCell: 'F45',
    },
    {
      key: 'tsla',
      name: 'TSLA',
      category: 'Stock Assets',
      qtyCell: 'D43',
      purchasePriceCell: 'C43',
      currentPriceCell: 'F42',
    },
  ],
};

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

const PORTFOLIO_CONFIG = normalizeConfig(parseJsonObject(import.meta.env.VITE_PORTFOLIO_CONFIG));

export default PORTFOLIO_CONFIG;
