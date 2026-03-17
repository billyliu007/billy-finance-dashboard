import { query, withDbClient } from '../db/client.js';

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

/**
 * List cash components for a user. Balance in local currency; negative = debt.
 * @param {string} userId
 * @returns {Promise<object[]>} { currency, name, balance }[]
 */
export async function listCashComponents(userId) {
  const result = await query(
    `SELECT id,
            upper(currency) AS currency,
            name,
            balance::float8 AS balance
     FROM cash
     WHERE user_id = $1
     ORDER BY currency ASC, name ASC`,
    [userId],
  );
  return result.rows;
}

export async function replaceCashComponents(userId, components) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM cash WHERE user_id = $1`, [userId]);
      for (const item of components) {
        const balance = Number(item.balance ?? item.amount ?? 0);
        if (!Number.isFinite(balance)) continue;
        await client.query(
          `INSERT INTO cash (user_id, currency, name, balance)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            String(item.currency || '').toUpperCase(),
            String(item.name ?? item.displayName ?? '').trim() || 'Cash',
            balance,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * List portfolio positions for a user (symbol as name).
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listPortfolioPositions(userId) {
  const result = await query(
    `SELECT symbol,
            symbol AS name,
            category,
            COALESCE(NULLIF(TRIM(currency), ''), 'USD') AS currency,
            qty::float8 AS qty,
            purchase_price::float8 AS "purchasePrice",
            market_provider AS "marketProvider",
            market_instrument_id AS "marketInstrumentId"
     FROM portfolio_positions
     WHERE user_id = $1
     ORDER BY symbol ASC`,
    [userId],
  );
  return result.rows;
}

export async function replacePortfolioPositions(userId, positions) {
  const cryptoInstrumentIds = [
    ...new Set(
      (positions || [])
        .filter((item) => /crypto/i.test(String(item.category || '')) && item.marketInstrumentId)
        .map((item) => String(item.marketInstrumentId).trim().toUpperCase()),
    ),
  ];
  const quoteCurrencyByProductId = await findCoinbaseQuoteCurrenciesByIds(cryptoInstrumentIds);

  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [userId]);
      for (const item of positions) {
        let currency = item.currency && String(item.currency).trim() ? String(item.currency).trim().toUpperCase() : null;
        if (!currency) {
          const cat = String(item.category || '').trim();
          if (cat === 'US Stock Assets' || /stock/i.test(cat)) {
            currency = 'USD';
          } else if (/crypto/i.test(cat) && item.marketInstrumentId) {
            const productId = String(item.marketInstrumentId).trim().toUpperCase();
            currency = quoteCurrencyByProductId.get(productId) || 'USD';
          } else {
            currency = 'USD';
          }
        }
        await client.query(
          `INSERT INTO portfolio_positions (user_id, symbol, category, currency, qty, purchase_price, market_provider, market_instrument_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            userId,
            String(item.symbol || '').toUpperCase(),
            item.category || 'US Stock Assets',
            currency,
            Number(item.qty || 0),
            Number(item.purchasePrice || 0),
            item.marketProvider || null,
            item.marketInstrumentId || null,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/**
 * Search US stock symbols by symbol or security name (excludes test issues).
 * @param {{ queryText?: string, limit?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function listUsStockSymbols({ queryText, limit = 50 } = {}) {
  const trimmed = String(queryText || '').trim();
  if (!trimmed) {
    return [];
  }

  const like = `%${trimmed}%`;
  const result = await query(
    `SELECT symbol,
            security_name AS "securityName",
            exchange
     FROM us_stock_symbols
     WHERE (symbol ILIKE $1 OR security_name ILIKE $1)
       AND COALESCE(test_issue, FALSE) = FALSE
     ORDER BY symbol ASC
     LIMIT $2`,
    [like, Math.max(1, Math.min(Number(limit) || 50, 200))],
  );
  return result.rows;
}

/**
 * List net worth history rows for a user (date, recordedAtUtc, netWorth).
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listNetWorthHistory(userId) {
  const result = await query(
    `SELECT to_char(date_utc, 'YYYY-MM-DD') AS date,
            to_char(recorded_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAtUtc",
            total_cny::float8 AS "netWorthCny",
            total_usd::float8 AS "netWorthUsd"
     FROM networth_history
     WHERE user_id = $1
     ORDER BY recorded_at_utc ASC`,
    [userId],
  );
  return result.rows;
}

export async function replaceNetWorthHistory(userId, historyRows) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [userId]);
      for (const row of historyRows || []) {
        const recordedAtUtc = String(row?.recordedAtUtc || '').trim();
        const dateUtc = String(row?.date || '').trim() || (recordedAtUtc ? recordedAtUtc.slice(0, 10) : '');
        const totalCny = Number(row?.netWorth || 0);
        if (!dateUtc || !recordedAtUtc || !Number.isFinite(totalCny)) {
          continue;
        }
        await client.query(
          `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, quality_status, computed_at)
           VALUES ($1, $2, $3, 'imported', $4, 'full', NOW())`,
          [userId, dateUtc, recordedAtUtc, totalCny],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function upsertNetWorthSnapshot({ userId, dateUtc, totalCny, totalUsd = null, qualityStatus = 'full' }) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM networth_history
         WHERE user_id = $1 AND date_utc = $2 AND source = 'daily'`,
        [userId, dateUtc],
      );
      const usdVal = totalUsd != null && Number.isFinite(Number(totalUsd)) ? Number(totalUsd) : null;
      await client.query(
        `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, total_usd, quality_status, computed_at)
         VALUES ($1, $2, NOW(), 'daily', $3, $4, $5, NOW())`,
        [userId, dateUtc, Number(totalCny || 0), usdVal, qualityStatus],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
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

/**
 * Create a crypto position from a Coinbase product (USDC/USDT). Throws if position exists.
 * @param {{ userId: string, productId: string, qty: number, avgCostPerUnit: number }} options
 * @returns {Promise<{ symbol: string, product: object }>}
 */
export async function createCryptoPositionFromCoinbaseProduct({
  userId,
  productId,
  qty,
  avgCostPerUnit,
}) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedQty = Number(qty);
  const resolvedCost = Number(avgCostPerUnit);
  if (!resolvedUserId) {
    throw new Error('Missing user id.');
  }
  if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
    throw new Error('Quantity must be greater than 0.');
  }
  if (!Number.isFinite(resolvedCost) || resolvedCost < 0) {
    throw new Error('Average cost per unit must be 0 or greater.');
  }

  const product = await findCoinbaseProduct(productId);
  if (!product) {
    throw new Error('Selected Coinbase product was not found.');
  }
  if (product.quoteCurrency !== 'USDC' && product.quoteCurrency !== 'USDT') {
    throw new Error('Selected Coinbase product must be quoted in USDC or USDT.');
  }

  const symbol = String(product.baseCurrency || '').trim().toUpperCase();
  if (!symbol) {
    throw new Error('Selected Coinbase product is missing base currency.');
  }

  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const existing = await client.query(
        `SELECT 1
         FROM portfolio_positions
         WHERE user_id = $1 AND symbol = $2`,
        [resolvedUserId, symbol],
      );
      if (existing.rowCount > 0) {
        throw new Error(`Position already exists for ${symbol}.`);
      }

      await client.query(
        `INSERT INTO portfolio_positions (
          user_id,
          symbol,
          category,
          currency,
          qty,
          purchase_price,
          market_provider,
          market_instrument_id
        )
        VALUES ($1, $2, 'Crypto Assets', $3, $4, $5, 'coinbase', $6)`,
        [resolvedUserId, symbol, (product.quoteCurrency || 'USD').toUpperCase(), resolvedQty, resolvedCost, product.productId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { symbol, product };
}

/**
 * Create a stock position by symbol. Throws if position already exists.
 * @param {{ userId: string, symbol: string, qty: number, avgCostPerUnit: number }} options
 * @returns {Promise<{ symbol: string }>}
 */
export async function createStockPositionFromSymbol({ userId, symbol, qty, avgCostPerUnit }) {
  const resolvedUserId = String(userId || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const resolvedQty = Number(qty);
  const resolvedCost = Number(avgCostPerUnit);

  if (!resolvedUserId) {
    throw new Error('Missing user id.');
  }
  if (!normalizedSymbol) {
    throw new Error('Stock symbol is required.');
  }
  if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
    throw new Error('Quantity must be greater than 0.');
  }
  if (!Number.isFinite(resolvedCost) || resolvedCost < 0) {
    throw new Error('Average cost per unit must be 0 or greater.');
  }

  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const existing = await client.query(
        `SELECT 1
         FROM portfolio_positions
         WHERE user_id = $1 AND symbol = $2`,
        [resolvedUserId, normalizedSymbol],
      );
      if (existing.rowCount > 0) {
        throw new Error(`Position already exists for ${normalizedSymbol}.`);
      }

      await client.query(
        `INSERT INTO portfolio_positions (
          user_id,
          symbol,
          category,
          currency,
          qty,
          purchase_price,
          market_provider,
          market_instrument_id
        )
        VALUES ($1, $2, 'US Stock Assets', 'USD', $3, $4, NULL, NULL)`,
        [resolvedUserId, normalizedSymbol, resolvedQty, resolvedCost],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { symbol: normalizedSymbol };
}

/**
 * Update an existing position's quantity and average cost (any asset).
 * @param {{ userId: string, symbol: string, qty: number, avgCostPerUnit: number }} options
 * @returns {Promise<{ symbol: string }>}
 */
export async function updatePosition({ userId, symbol, qty, avgCostPerUnit }) {
  const resolvedUserId = String(userId || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const resolvedQty = Number(qty);
  const resolvedCost = Number(avgCostPerUnit);

  if (!resolvedUserId || !normalizedSymbol) {
    throw new Error('User id and symbol are required.');
  }
  if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
    throw new Error('Quantity must be greater than 0.');
  }
  if (!Number.isFinite(resolvedCost) || resolvedCost < 0) {
    throw new Error('Average cost per unit must be 0 or greater.');
  }

  const result = await query(
    `UPDATE portfolio_positions
     SET qty = $3, purchase_price = $4, updated_at = NOW()
     WHERE user_id = $1 AND symbol = $2
     RETURNING symbol`,
    [resolvedUserId, normalizedSymbol, resolvedQty, resolvedCost],
  );
  if (result.rowCount === 0) {
    throw new Error(`Position not found for ${normalizedSymbol}.`);
  }
  return { symbol: normalizedSymbol };
}

/**
 * Delete a position by symbol (user-scoped).
 * @param {string} userId
 * @param {string} symbol
 * @returns {Promise<{ symbol: string }>}
 */
export async function deletePosition(userId, symbol) {
  const resolvedUserId = String(userId || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!resolvedUserId || !normalizedSymbol) {
    throw new Error('User id and symbol are required.');
  }

  const result = await query(
    `DELETE FROM portfolio_positions
     WHERE user_id = $1 AND symbol = $2
     RETURNING symbol`,
    [resolvedUserId, normalizedSymbol],
  );
  if (result.rowCount === 0) {
    throw new Error(`Position not found for ${normalizedSymbol}.`);
  }
  return { symbol: normalizedSymbol };
}
