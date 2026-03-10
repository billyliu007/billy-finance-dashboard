import { query, withDbClient } from '../db/client.js';

export async function listCashComponents(userId) {
  const result = await query(
    `SELECT component_key AS key,
            display_name AS name,
            component_type AS type,
            category,
            upper(currency) AS currency,
            amount::float8 AS amount
     FROM cash_components
     WHERE user_id = $1
     ORDER BY component_key ASC`,
    [userId],
  );
  return result.rows;
}

export async function replaceCashComponents(userId, components) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM cash_components WHERE user_id = $1`, [userId]);
      for (const item of components) {
        await client.query(
          `INSERT INTO cash_components (user_id, component_key, display_name, component_type, category, currency, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            item.key,
            item.name,
            item.type,
            item.category || 'Cash',
            String(item.currency || '').toUpperCase(),
            Number(item.amount || 0),
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

export async function listPortfolioPositions(userId) {
  const result = await query(
    `SELECT symbol,
            symbol AS name,
            category,
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
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [userId]);
      for (const item of positions) {
        await client.query(
          `INSERT INTO portfolio_positions (user_id, symbol, category, qty, purchase_price, market_provider, market_instrument_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            String(item.symbol || '').toUpperCase(),
            item.category || 'Stock Assets',
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

export async function listNetWorthHistory(userId) {
  const result = await query(
    `SELECT to_char(date_utc, 'YYYY-MM-DD') AS date,
            to_char(recorded_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAtUtc",
            total_cny::float8 AS "netWorth"
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

export async function upsertNetWorthSnapshot({ userId, dateUtc, totalCny, qualityStatus = 'full' }) {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM networth_history
         WHERE user_id = $1 AND date_utc = $2 AND source = 'daily'`,
        [userId, dateUtc],
      );
      await client.query(
        `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, quality_status, computed_at)
         VALUES ($1, $2, NOW(), 'daily', $3, $4, NOW())`,
        [userId, dateUtc, Number(totalCny || 0), qualityStatus],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

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
          qty,
          purchase_price,
          market_provider,
          market_instrument_id
        )
        VALUES ($1, $2, 'Crypto Assets', $3, $4, 'coinbase', $5)`,
        [resolvedUserId, symbol, resolvedQty, resolvedCost, product.productId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { symbol, product };
}

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
          qty,
          purchase_price,
          market_provider,
          market_instrument_id
        )
        VALUES ($1, $2, 'Stock Assets', $3, $4, NULL, NULL)`,
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
