import { Pool } from 'pg';

let pool;

function parsePoolMax() {
  const raw = process.env.PGPOOL_MAX;
  if (raw == null || String(raw).trim() === '') {
    return 10;
  }
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) {
    return 10;
  }
  return Math.min(n, 50);
}

/**
 * Singleton connection pool for Postgres (Neon, Render Postgres, local).
 * Use {@link withTransaction} for ACID transactions; {@link withDbClient} when you need a client without wrapping BEGIN/COMMIT; {@link query} for one-off statements.
 *
 * For serverless/edge runtimes, prefer @neondatabase/serverless in a dedicated entrypoint—
 * not mixed with this Pool in the same long-lived process.
 */
export function getPool() {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL in environment.');
  }

  pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: parsePoolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  return pool;
}

export async function withDbClient(task) {
  const db = getPool();
  const client = await db.connect();
  try {
    return await task(client);
  } finally {
    client.release();
  }
}

/**
 * Runs `task(client)` inside BEGIN/COMMIT or ROLLBACK on error.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function withTransaction(task) {
  return withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await task(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function query(text, params = []) {
  const db = getPool();
  return db.query(text, params);
}
