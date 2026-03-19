import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDbClient } from './client.js';
import { applySqlMigrations, ensureSchemaMigrationsTable } from './migrationsRunner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../../db/schema.sql');

async function run() {
  const schemaSql = readFileSync(schemaPath, 'utf8');
  await withDbClient(async (client) => {
    await ensureSchemaMigrationsTable(client);
    await client.query(schemaSql);
    await applySqlMigrations(client);
  });
  // eslint-disable-next-line no-console
  console.log('Database schema migration completed.');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
