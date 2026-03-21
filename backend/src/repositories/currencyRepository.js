import { query } from '../db/client.js';

/**
 * List active currencies (code, name) for dropdowns and validation.
 * @returns {Promise<object[]>}
 */
export async function listCurrencies() {
  const result = await query(
    `SELECT code, name
     FROM currencies
     WHERE active = true
     ORDER BY code ASC`,
    [],
  );
  return result.rows;
}
