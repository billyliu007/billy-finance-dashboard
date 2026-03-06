import { parseJsonObject } from './utils/config';

const DEFAULT_CONFIG = {
  netWorthRange: "'Net Worth'!A1:Z1000",
  detailItems: [
    {
      key: 'sgd_cash',
      cellRef: 'B3',
      displayName: 'SGD Cash (DBS Savings)',
      type: 'asset',
      category: 'Cash',
      currency: 'SGD',
    },
    {
      key: 'USD_cash',
      cellRef: 'B12',
      displayName: 'USD Cash (Moomoo)',
      type: 'asset',
      category: 'Cash',
      currency: 'USD',
    },
    {
      key: 'USDT/USDC_cash',
      cellRef: 'B11',
      displayName: 'USDT/USDC(Binance)',
      type: 'asset',
      category: 'Cash',
      currency: 'USD',
    },
    {
      key: 'cny_cash_debt',
      cellRef: 'B17',
      displayName: 'CNY Cash Debt',
      type: 'liability',
      category: 'Debt',
      currency: 'CNY',
    },
  ],
  forexRange: "'Forex'!A1:C20",
  forexRates: [
    { currency: 'SGD', cellRef: 'C1' },
    { currency: 'USD', cellRef: 'C2' },
  ],
};

function normalizeConfig(userConfig) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...userConfig,
  };

  if (!Array.isArray(merged.detailItems)) {
    merged.detailItems = DEFAULT_CONFIG.detailItems;
  }

  if (!Array.isArray(merged.forexRates) || merged.forexRates.length === 0) {
    merged.forexRates = DEFAULT_CONFIG.forexRates;
  }

  if (typeof merged.netWorthRange !== 'string' || merged.netWorthRange.trim() === '') {
    merged.netWorthRange = DEFAULT_CONFIG.netWorthRange;
  }

  if (typeof merged.forexRange !== 'string' || merged.forexRange.trim() === '') {
    merged.forexRange = DEFAULT_CONFIG.forexRange;
  }

  return merged;
}

const DASHBOARD_CONFIG = normalizeConfig(parseJsonObject(import.meta.env.VITE_DASHBOARD_CONFIG));

export default DASHBOARD_CONFIG;
