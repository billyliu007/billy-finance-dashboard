import { query, withTransaction } from '../db/client.js';

/**
 * List net worth history rows for a user (date, recordedAtUtc, netWorth).
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listNetWorthHistory(userId) {
  const result = await query(
    `SELECT to_char(h.date_utc, 'YYYY-MM-DD') AS date,
            to_char(h.recorded_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAtUtc",
            h.total_cny::float8 AS "netWorthCny",
            h.total_usd::float8 AS "netWorthUsd",
            fx.rates AS "sharedFxRates"
     FROM networth_history h
     LEFT JOIN fx_daily_rates fx ON fx.id = h.fx_rate_set_id
     WHERE h.user_id = $1
     ORDER BY h.recorded_at_utc ASC`,
    [userId],
  );
  return result.rows;
}

export async function replaceNetWorthHistory(userId, historyRows) {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [userId]);
    for (const row of historyRows || []) {
      const recordedAtUtc = String(row?.recordedAtUtc || '').trim();
      const dateUtc = String(row?.date || '').trim() || (recordedAtUtc ? recordedAtUtc.slice(0, 10) : '');
      const totalCny = Number(row?.netWorth || 0);
      if (!dateUtc || !recordedAtUtc || !Number.isFinite(totalCny)) {
        continue;
      }
      await client.query(
        `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, quality_status, computed_at)
         VALUES ($1, $2, $3, 'imported', $4, 'full', NOW())`,
        [userId, dateUtc, recordedAtUtc, totalCny],
      );
    }
  });
}

export async function upsertNetWorthSnapshot({
  userId,
  dateUtc,
  totalCny,
  totalUsd = null,
  fxRateSetId = null,
  qualityStatus = 'full',
}) {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM networth_history
       WHERE user_id = $1 AND date_utc = $2 AND source = 'daily'`,
      [userId, dateUtc],
    );
    const usdVal = totalUsd != null && Number.isFinite(Number(totalUsd)) ? Number(totalUsd) : null;
    const cnyVal = totalCny != null && Number.isFinite(Number(totalCny)) ? Number(totalCny) : null;
    await client.query(
      `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, total_usd, fx_rate_set_id, quality_status, computed_at)
       VALUES ($1, $2, NOW(), 'daily', $3, $4, $5, $6, NOW())`,
      [userId, dateUtc, cnyVal, usdVal, fxRateSetId, qualityStatus],
    );
  });
}
