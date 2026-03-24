import { query } from '../db/client.js';

export async function upsertDailyFxRateSet({ dateUtc, provider = 'frankfurter', rates = {} }) {
  const normalizedDate = String(dateUtc || '').trim();
  if (!normalizedDate) {
    throw new Error('dateUtc is required.');
  }

  const providerName = String(provider || 'frankfurter').trim().toLowerCase() || 'frankfurter';
  // Rates map: USD per 1 unit of each currency (Frankfurter-derived). USD is always 1.
  // CNY should be present when the provider returns it so snapshots can derive total_cny from total_usd.
  const normalizedRates = Object.entries(rates || {}).reduce((acc, [code, value]) => {
    const currency = String(code || '').trim().toUpperCase();
    const numeric = Number(value);
    if (currency && Number.isFinite(numeric) && numeric > 0) {
      acc[currency] = numeric;
    }
    return acc;
  }, { USD: 1 });

  const result = await query(
    `INSERT INTO fx_daily_rates (date_utc, provider, rates, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (date_utc, provider)
     DO UPDATE SET rates = EXCLUDED.rates, updated_at = NOW()
     RETURNING id`,
    [normalizedDate, providerName, JSON.stringify(normalizedRates)],
  );
  return result.rows[0]?.id || null;
}
