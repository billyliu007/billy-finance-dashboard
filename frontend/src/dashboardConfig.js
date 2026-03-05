const DEFAULT_CONFIG = {
  valueColumnIndex: 1,
  totalComponents: [
    {
      key: 'sgd_assets_in_cny',
      cellRef: 'B26',
      labelMatch: 'SGD Assets Total (As in RMB)',
      displayName: 'SGD Assets Total (As in RMB)',
    },
    {
      key: 'usd_assets_in_cny',
      cellRef: 'B29',
      labelMatch: 'USD Assets Total (As in RMB)',
      displayName: 'USD Assets Total (As in RMB)',
    },
    {
      key: 'cny_assets_total',
      cellRef: 'B30',
      labelMatch: 'RMB Assets Total',
      displayName: 'RMB Assets Total',
    },
  ],
  breakdown: {
    labelColumnIndex: 0,
    valueColumnIndex: 1,
    percentColumnIndex: 2,
  },
};

function parseJsonConfig(raw) {
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
    breakdown: {
      ...DEFAULT_CONFIG.breakdown,
      ...(userConfig.breakdown || {}),
    },
  };

  if (!Array.isArray(merged.totalComponents) || merged.totalComponents.length === 0) {
    merged.totalComponents = DEFAULT_CONFIG.totalComponents;
  }

  return merged;
}

const DASHBOARD_CONFIG = normalizeConfig(parseJsonConfig(import.meta.env.VITE_DASHBOARD_CONFIG));

export default DASHBOARD_CONFIG;
