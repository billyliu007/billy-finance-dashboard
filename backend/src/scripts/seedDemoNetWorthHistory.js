/**
 * Seeds the demo user's net worth history for the last 60 days.
 * Each day's total net worth is within ±30% of 0.5M USD (350k–650k).
 * Run after the demo user exists (e.g. after at least one demo login).
 *
 * Usage: node backend/src/scripts/seedDemoNetWorthHistory.js
 */
import 'dotenv/config';
import { withDbClient } from '../db/client.js';

const DEMO_EMAIL = 'demo@myworthtrack.local';
const TARGET_USD = 500_000;
const MIN_USD = Math.round(TARGET_USD * 0.7);   // 350_000
const MAX_USD = Math.round(TARGET_USD * 1.3);   // 650_000
const DAYS = 60;
const CNY_PER_USD = 7.24;

/**
 * Generate 60 daily net worth values (USD) in a rough random walk staying within [MIN_USD, MAX_USD].
 */
function generateDailyNetWorths() {
  const values = [];
  let current = TARGET_USD;
  const stepPct = 0.02;
  for (let i = 0; i < DAYS; i++) {
    const change = (Math.random() - 0.48) * stepPct * current;
    current = Math.round(current + change);
    current = Math.max(MIN_USD, Math.min(MAX_USD, current));
    values.push(current);
  }
  return values;
}

function getDateUtc(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function formatRecordedAtUtc(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function run() {
  await withDbClient(async (client) => {
    const { rows: userRows } = await client.query(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [DEMO_EMAIL],
    );
    if (userRows.length === 0) {
      console.error('Demo user not found. Log in once with the demo account, then run this script.');
      process.exitCode = 1;
      return;
    }
    const userId = userRows[0].id;

    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [userId]);

      const dailyUsd = generateDailyNetWorths();
      for (let i = 0; i < DAYS; i++) {
        const daysAgo = DAYS - 1 - i;
        const date = getDateUtc(daysAgo);
        const dateStr = formatDateUtc(date);
        const recordedStr = formatRecordedAtUtc(date);
        const usd = dailyUsd[i];
        const cny = Math.round(usd * CNY_PER_USD * 100) / 100;

        await client.query(
          `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, total_usd, quality_status, computed_at)
           VALUES ($1, $2, $3::timestamptz, 'daily', $4, $5, 'full', NOW())`,
          [userId, dateStr, recordedStr, cny, usd],
        );
      }

      await client.query('COMMIT');
      console.log(`Seeded ${DAYS} days of net worth history for demo user (${DEMO_EMAIL}).`);
      console.log(`USD range: ${Math.min(...dailyUsd).toLocaleString()} – ${Math.max(...dailyUsd).toLocaleString()}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
