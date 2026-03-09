import { query, withDbClient } from '../db/client.js';

export async function listCashComponents(userId) {
  const result = await query(
    `SELECT component_key AS key,
            display_name AS name,
            component_type AS type,
            category,
            upper(currency) AS currency,
            amount::float8 AS amount
     FROM cash_components
     WHERE user_id = $1
     ORDER BY component_key ASC`,
    [userId],
  );
  return result.rows;
}

export async function replaceCashComponents(userId, components) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM cash_components WHERE user_id = $1`, [userId]);
      for (const item of components) {
        await client.query(
          `INSERT INTO cash_components (user_id, component_key, display_name, component_type, category, currency, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            item.key,
            item.name,
            item.type,
            item.category || 'Cash',
            String(item.currency || '').toUpperCase(),
            Number(item.amount || 0),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function listPortfolioPositions(userId) {
  const result = await query(
    `SELECT symbol,
            display_name AS name,
            category,
            qty::float8 AS qty,
            purchase_price::float8 AS "purchasePrice"
     FROM portfolio_positions
     WHERE user_id = $1
     ORDER BY symbol ASC`,
    [userId],
  );
  return result.rows;
}

export async function replacePortfolioPositions(userId, positions) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [userId]);
      for (const item of positions) {
        await client.query(
          `INSERT INTO portfolio_positions (user_id, symbol, display_name, category, qty, purchase_price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            String(item.symbol || '').toUpperCase(),
            item.name || String(item.symbol || '').toUpperCase(),
            item.category || 'Stock Assets',
            Number(item.qty || 0),
            Number(item.purchasePrice || 0),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function listNetWorthHistory(userId) {
  const result = await query(
    `SELECT to_char(date_utc, 'YYYY-MM-DD') AS date,
            to_char(recorded_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAtUtc",
            total_cny::float8 AS "netWorth"
     FROM networth_history
     WHERE user_id = $1
     ORDER BY recorded_at_utc ASC`,
    [userId],
  );
  return result.rows;
}

export async function replaceNetWorthHistory(userId, historyRows) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
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
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function upsertNetWorthSnapshot({ userId, dateUtc, totalCny, qualityStatus = 'full' }) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM networth_history
         WHERE user_id = $1 AND date_utc = $2 AND source = 'daily'`,
        [userId, dateUtc],
      );
      await client.query(
        `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, quality_status, computed_at)
         VALUES ($1, $2, NOW(), 'daily', $3, $4, NOW())`,
        [userId, dateUtc, Number(totalCny || 0), qualityStatus],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
