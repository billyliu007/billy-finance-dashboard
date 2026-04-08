import { query } from '../db/client.js';

/** Escape `%`, `_`, and `\` for use in ILIKE patterns (PostgreSQL default escape `\`). */
function escapeILikePattern(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Search US stock symbols by symbol or security name (excludes test issues).
 * Ranks: exact ticker → ticker prefix → ticker substring → name-only match (so e.g. TSLA is first for query "TSLA").
 * @param {{ queryText?: string, limit?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function listUsStockSymbols({ queryText, limit = 50 } = {}) {
  const trimmed = String(queryText || '').trim();
  if (!trimmed) {
    return [];
  }

  const safe = escapeILikePattern(trimmed);
  const likeAny = `%${safe}%`;
  const likePrefix = `${safe}%`;
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));

  const result = await query(
    `SELECT symbol,
            security_name AS "securityName",
            exchange
     FROM us_stock_symbols
     WHERE (symbol ILIKE $1 OR security_name ILIKE $1)
       AND COALESCE(test_issue, FALSE) = FALSE
     ORDER BY
       CASE
         WHEN UPPER(symbol) = UPPER($2::text) THEN 0
         WHEN symbol ILIKE $3 THEN 1
         WHEN symbol ILIKE $1 THEN 2
         ELSE 3
       END,
       symbol ASC
     LIMIT $4`,
    [likeAny, trimmed, likePrefix, lim],
  );
  return result.rows;
}

/**
 * List Coinbase products (USDC/USDT) matching query.
 * @param {{ queryText?: string, limit?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function listCoinbaseProducts({ queryText = '', limit = 200 } = {}) {
  const q = String(queryText || '').trim().toUpperCase();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const result = await query(
    `SELECT product_id AS "productId",
            base_currency AS "baseCurrency",
            quote_currency AS "quoteCurrency",
            status,
            updated_at AS "updatedAt"
     FROM coinbase_products
     WHERE quote_currency IN ('USDC', 'USDT')
       AND (
         $1 = ''
         OR product_id ILIKE '%' || $1 || '%'
         OR base_currency ILIKE '%' || $1 || '%'
       )
     ORDER BY base_currency ASC, quote_currency ASC
     LIMIT ${safeLimit}`,
    [q],
  );
  return result.rows;
}

/**
 * Fetch a single Coinbase product by id.
 * @param {string} productId
 * @returns {Promise<object|null>}
 */
export async function findCoinbaseProduct(productId) {
  const id = String(productId || '').trim().toUpperCase();
  if (!id) {
    return null;
  }
  const result = await query(
    `SELECT product_id AS "productId",
            base_currency AS "baseCurrency",
            quote_currency AS "quoteCurrency",
            status
     FROM coinbase_products
     WHERE product_id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

/**
 * Fetch multiple Coinbase products by ids; returns Map(productId -> quoteCurrency).
 * Use for batch lookup to avoid N+1 (e.g. in replacePortfolioPositions).
 * @param {string[]} productIds
 * @returns {Promise<Map<string, string>>}
 */
export async function findCoinbaseQuoteCurrenciesByIds(productIds) {
  const ids = [...new Set((productIds || []).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean))];
  if (ids.length === 0) {
    return new Map();
  }
  const result = await query(
    `SELECT product_id, quote_currency
     FROM coinbase_products
     WHERE product_id = ANY($1::text[])`,
    [ids],
  );
  return new Map(result.rows.map((r) => [r.product_id, r.quote_currency]));
}
