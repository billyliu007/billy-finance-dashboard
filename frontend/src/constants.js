// In local development, use same-origin (/api) so LAN clients work via Vite proxy.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
export const SHOW_DEVELOPMENT_PAGE =
  import.meta.env.VITE_SHOW_DEVELOPMENT_PAGE === 'true' || import.meta.env.DEV;

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
