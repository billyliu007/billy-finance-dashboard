export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export const HOLDING_COLORS = [
  '#22d3ee',
  '#f59e0b',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#60a5fa',
  '#f87171',
  '#facc15',
];

export const CASHFLOW_RANGE = "'Cashflow'!A1:C400";

export const NET_WORTH_COMPONENTS = [
  { key: 'sgd_assets_in_cny', displayName: 'SGD Assets Total (As in CNY)' },
  { key: 'usd_assets_in_cny', displayName: 'USD Assets Total (As in CNY)' },
  { key: 'cny_assets_total', displayName: 'CNY Assets Total' },
];
