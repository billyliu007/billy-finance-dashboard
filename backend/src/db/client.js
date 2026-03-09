import { Pool } from 'pg';

let pool;

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

export async function query(text, params = []) {
  const db = getPool();
  return db.query(text, params);
}
