/**
 * Sync currencies from Frankfurter API into the currencies table.
 * Run: node src/scripts/syncCurrencies.js (from backend directory)
 */
import 'dotenv/config';
import { withDbClient } from '../db/client.js';

const FRANKFURTER_CURRENCIES_URL = 'https://api.frankfurter.app/currencies';

async function run() {
  const response = await fetch(FRANKFURTER_CURRENCIES_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Frankfurter API failed: ${response.status}`);
  }
  const data = await response.json();
  const entries = Object.entries(data || {}).filter(
    ([code, name]) => typeof code === 'string' && code.length === 3 && typeof name === 'string',
  );

  await withDbClient(async (client) => {
    for (const [code, name] of entries) {
      await client.query(
        `INSERT INTO currencies (code, name, active, updated_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [code.trim().toUpperCase(), String(name).trim()],
      );
    }
  });

  console.log(`Synced ${entries.length} currencies from Frankfurter.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
