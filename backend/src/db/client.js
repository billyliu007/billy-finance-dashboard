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

function parseIntEnv(name, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPgError(error) {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');

  // Connection churn / transient network hiccups (common for cron + managed DBs)
  if (
    msg.includes('Connection terminated due to connection timeout') ||
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EAI_AGAIN')
  ) {
    return true;
  }

  // Postgres/server-side transient errors.
  // 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now, 53300 too_many_connections
  if (code === '57P01' || code === '57P02' || code === '57P03' || code === '53300') {
    return true;
  }

  return false;
}

async function resetPool() {
  if (!pool) return;
  const toClose = pool;
  pool = undefined;
  try {
    await toClose.end();
  } catch {
    // ignore - we're already in an error path
  }
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

  const connectionTimeoutMillis = parseIntEnv('PG_CONNECTION_TIMEOUT_MS', 30_000, {
    min: 1_000,
    max: 120_000,
  });
  const idleTimeoutMillis = parseIntEnv('PG_IDLE_TIMEOUT_MS', 30_000, { min: 1_000, max: 300_000 });

  pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: parsePoolMax(),
    idleTimeoutMillis,
    connectionTimeoutMillis,
  });
  return pool;
}

export async function withDbClient(task) {
  const attempts = parseIntEnv('PG_RETRY_ATTEMPTS', 3, { min: 1, max: 10 });
  const baseDelayMs = parseIntEnv('PG_RETRY_BASE_DELAY_MS', 750, { min: 0, max: 30_000 });

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const db = getPool();
    let client;
    try {
      client = await db.connect();
      return await task(client);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientPgError(error)) {
        throw error;
      }
      await resetPool();
      const delay = Math.round(baseDelayMs * attempt);
      await sleep(delay);
    } finally {
      try {
        client?.release?.();
      } catch {
        // ignore
      }
    }
  }

  throw lastError;
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
  const attempts = parseIntEnv('PG_RETRY_ATTEMPTS', 3, { min: 1, max: 10 });
  const baseDelayMs = parseIntEnv('PG_RETRY_BASE_DELAY_MS', 750, { min: 0, max: 30_000 });

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const db = getPool();
      return await db.query(text, params);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientPgError(error)) {
        throw error;
      }
      await resetPool();
      const delay = Math.round(baseDelayMs * attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}
