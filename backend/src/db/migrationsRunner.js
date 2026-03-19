import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Apply versioned SQL migrations from backend/db/migrations.
 * Each file must be named like: 20260319_description.sql (timestamp prefix recommended).
 */
export async function applySqlMigrations(client, { migrationsDir } = {}) {
  const defaultDir = resolve(
    resolve(fileURLToPath(import.meta.url), '..'),
    '../../db/migrations',
  );
  const dir = migrationsDir || defaultDir;

  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  } catch {
    // No migrations directory (yet)
    return { applied: 0, skipped: 0, files: [] };
  }

  files.sort((a, b) => a.localeCompare(b));

  const appliedRows = await client.query(`SELECT id, checksum FROM schema_migrations`);
  const applied = new Map(appliedRows.rows.map((r) => [String(r.id), String(r.checksum)]));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const id = file;
    const fullPath = resolve(dir, file);
    const sql = readFileSync(fullPath, 'utf8');
    const checksum = sha256(sql);

    const existing = applied.get(id);
    if (existing) {
      // Detect drift: if the file content changed after being applied, fail fast.
      if (existing !== checksum) {
        const err = new Error(`Migration checksum mismatch for ${id}. Expected ${existing}, got ${checksum}.`);
        err.statusCode = 500;
        throw err;
      }
      skippedCount += 1;
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)`,
        [id, checksum],
      );
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  return { applied: appliedCount, skipped: skippedCount, files };
}

