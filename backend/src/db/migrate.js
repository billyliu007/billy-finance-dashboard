import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDbClient } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../../db/schema.sql');

async function run() {
  const schemaSql = readFileSync(schemaPath, 'utf8');
  await withDbClient(async (client) => {
    await client.query(schemaSql);
    await client.query(`
      ALTER TABLE networth_history
      ADD COLUMN IF NOT EXISTS recorded_at_utc TIMESTAMPTZ;
    `);
    await client.query(`
      ALTER TABLE networth_history
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
    `);
    await client.query(`
      UPDATE networth_history
      SET recorded_at_utc = COALESCE(recorded_at_utc, (date_utc::text || 'T00:00:00Z')::timestamptz);
    `);
    await client.query(`
      ALTER TABLE networth_history
      ALTER COLUMN recorded_at_utc SET NOT NULL;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'networth_history_user_id_date_utc_key'
        ) THEN
          ALTER TABLE networth_history
          DROP CONSTRAINT networth_history_user_id_date_utc_key;
        END IF;
      END$$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_networth_history_user_recorded_source
      ON networth_history (user_id, recorded_at_utc, source);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_networth_history_user_id_date
      ON networth_history (user_id, date_utc DESC);
    `);
  });
  // eslint-disable-next-line no-console
  console.log('Database schema migration completed.');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
