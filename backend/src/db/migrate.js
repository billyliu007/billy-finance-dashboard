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
    await client.query(`
      ALTER TABLE portfolio_positions
      ADD COLUMN IF NOT EXISTS market_provider TEXT;
    `);
    await client.query(`
      ALTER TABLE portfolio_positions
      ADD COLUMN IF NOT EXISTS market_instrument_id TEXT;
    `);
    await client.query(`
      UPDATE portfolio_positions
      SET market_provider = 'coinbase',
          market_instrument_id = CASE UPPER(symbol)
            WHEN 'BTC' THEN 'BTC-USDT'
            WHEN 'ETH' THEN 'ETH-USDT'
            ELSE market_instrument_id
          END
      WHERE category ILIKE '%crypto%'
        AND market_provider IS NULL;
    `);
    await client.query(`
      ALTER TABLE portfolio_positions
      DROP COLUMN IF EXISTS display_name;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS currencies (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const currencyRows = [
      ['AUD', 'Australian Dollar'],
      ['BRL', 'Brazilian Real'],
      ['CAD', 'Canadian Dollar'],
      ['CHF', 'Swiss Franc'],
      ['CNY', 'Chinese Renminbi Yuan'],
      ['CZK', 'Czech Koruna'],
      ['DKK', 'Danish Krone'],
      ['EUR', 'Euro'],
      ['GBP', 'British Pound'],
      ['HKD', 'Hong Kong Dollar'],
      ['HUF', 'Hungarian Forint'],
      ['IDR', 'Indonesian Rupiah'],
      ['ILS', 'Israeli New Sheqel'],
      ['INR', 'Indian Rupee'],
      ['ISK', 'Icelandic Króna'],
      ['JPY', 'Japanese Yen'],
      ['KRW', 'South Korean Won'],
      ['MXN', 'Mexican Peso'],
      ['MYR', 'Malaysian Ringgit'],
      ['NOK', 'Norwegian Krone'],
      ['NZD', 'New Zealand Dollar'],
      ['PHP', 'Philippine Peso'],
      ['PLN', 'Polish Złoty'],
      ['RON', 'Romanian Leu'],
      ['SEK', 'Swedish Krona'],
      ['SGD', 'Singapore Dollar'],
      ['THB', 'Thai Baht'],
      ['TRY', 'Turkish Lira'],
      ['USD', 'United States Dollar'],
      ['ZAR', 'South African Rand'],
    ];
    for (const [code, name] of currencyRows) {
      await client.query(
        `INSERT INTO currencies (code, name, active, updated_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [code, name],
      );
    }
    // Migrate from cash_components to cash: new table has only id, user_id, currency, name, balance, updated_at (no "user" column)
    const hasOldTable = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'cash_components'
      LIMIT 1
    `);
    if (hasOldTable.rows.length > 0) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS cash (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
          currency TEXT NOT NULL,
          name TEXT NOT NULL,
          balance NUMERIC(20, 6) NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const cols = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cash_components'
        AND column_name IN ('name', 'display_name', 'balance', 'amount', 'component_type', 'updated_at')
      `);
      const colSet = new Set(cols.rows.map((r) => r.column_name));
      const hasName = colSet.has('name');
      const hasDisplayName = colSet.has('display_name');
      const hasBalance = colSet.has('balance');
      const hasAmount = colSet.has('amount');
      const hasType = colSet.has('component_type');
      const nameExpr = hasName
        ? 'TRIM(COALESCE(name, \'Cash\'))'
        : hasDisplayName
          ? 'TRIM(COALESCE(display_name, \'Cash\'))'
          : '\'Cash\'';
      const balanceExpr =
        hasBalance && !hasAmount
          ? 'balance'
          : hasAmount && hasType
            ? "CASE WHEN component_type = 'liability' THEN -ABS(amount) ELSE amount END"
            : hasAmount
              ? 'amount'
              : hasBalance
                ? 'balance'
                : '0';
      const updatedExpr = colSet.has('updated_at') ? 'updated_at' : 'NOW()';
      await client.query(`
        INSERT INTO cash (id, user_id, currency, name, balance, updated_at)
        SELECT id, user_id, UPPER(TRIM(currency)), ${nameExpr}, ${balanceExpr}, COALESCE(${updatedExpr}, NOW())
        FROM cash_components
      `);
      await client.query(`DROP TABLE cash_components`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_cash_user_id ON cash (user_id)`);
    }

    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'USD'
    `);
    await client.query(`
      UPDATE users SET base_currency = 'USD' WHERE base_currency IS NULL OR trim(base_currency) = ''
    `);

    await client.query(`
      ALTER TABLE networth_history ADD COLUMN IF NOT EXISTS total_usd NUMERIC(20, 6)
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
