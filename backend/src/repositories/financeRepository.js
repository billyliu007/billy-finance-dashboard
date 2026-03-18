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

export async function findCashById(userId, cashId) {
  const id = String(cashId || '').trim();
  if (!id) return null;
  const result = await query(
    `SELECT id,
            upper(currency) AS currency,
            name,
            balance::float8 AS balance
     FROM cash
     WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return result.rows[0] || null;
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

export async function listPositionTransactionAggregates(userId) {
  const result = await query(
    `SELECT upper(symbol) AS symbol,
            COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'BUY' THEN qty ELSE 0 END)::float8, 0) AS "buyQty",
            COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'BUY' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0) AS "buyCost",
            COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty ELSE 0 END)::float8, 0) AS "holdingSellQty",
            COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0) AS "holdingSellProceeds",
            COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty * cost_basis_per_unit ELSE 0 END)::float8, 0) AS "holdingSellCost",
            COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty ELSE 0 END)::float8, 0) AS "realizedSellQty",
            COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0) AS "realizedSellProceeds",
            COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty * cost_basis_per_unit ELSE 0 END)::float8, 0) AS "realizedSellCost"
     FROM portfolio_position_transactions
     WHERE user_id = $1
     GROUP BY upper(symbol)`,
    [userId],
  );
  return result.rows;
}

export async function listPositionTransactions(userId, symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];
  const result = await query(
    `SELECT id,
            upper(type) AS type,
            to_char(tx_date, 'YYYY-MM-DD') AS "txDate",
            qty::float8 AS qty,
            avg_cost_per_unit::float8 AS "avgCostPerUnit",
            cost_basis_per_unit::float8 AS "costBasisPerUnit",
            notes,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS "createdAtUtc"
     FROM portfolio_position_transactions
     WHERE user_id = $1 AND upper(symbol) = $2 AND affects_holdings = TRUE
     ORDER BY tx_date DESC, created_at DESC`,
    [userId, sym],
  );
  return result.rows;
}

export async function createPositionTransaction({
  userId,
  symbol,
  txDate,
  qty,
  avgCostPerUnit,
  type = 'BUY',
  costBasisPerUnit = null,
  notes = null,
  deductCashId = null,
  creditCashId = null,
}) {
  const resolvedUserId = String(userId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  const date = String(txDate || '').trim();
  const q = Number(qty);
  const cost = Number(avgCostPerUnit);
  const txType = String(type || 'BUY').trim().toUpperCase() || 'BUY';
  const basisOverride = costBasisPerUnit == null ? null : Number(costBasisPerUnit);
  const memo = notes == null ? null : String(notes).trim() || null;
  const deductId = deductCashId ? String(deductCashId).trim() : null;
  const creditId = creditCashId ? String(creditCashId).trim() : null;

  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!sym) throw new Error('Symbol is required.');
  if (!date) throw new Error('Transaction date is required.');
  if (!Number.isFinite(q) || q <= 0) throw new Error('Quantity must be greater than 0.');
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Average cost per unit must be 0 or greater.');
  if (txType !== 'BUY' && txType !== 'SELL') throw new Error('Transaction type must be BUY or SELL.');
  if (deductId && creditId) throw new Error('Choose either deductCashId or creditCashId, not both.');
  if (txType === 'SELL' && basisOverride != null && (!Number.isFinite(basisOverride) || basisOverride < 0)) {
    throw new Error('Cost basis per unit must be 0 or greater.');
  }

  const total = q * cost;

  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const positionRow = await client.query(
        `SELECT category, qty::float8 AS qty, purchase_price::float8 AS "purchasePrice"
         FROM portfolio_positions
         WHERE user_id = $1 AND symbol = $2`,
        [resolvedUserId, sym],
      );
      if (positionRow.rowCount === 0) {
        throw new Error('Position not found.');
      }
      const positionCategory = String(positionRow.rows[0].category || '');
      const isCrypto = /crypto/i.test(positionCategory);
      const baseQty = Number(positionRow.rows[0].qty) || 0;
      const baseAvg = Number(positionRow.rows[0].purchasePrice) || 0;
      const baseCost = baseQty * baseAvg;

      const agg = await client.query(
        `SELECT
            COALESCE(SUM(CASE WHEN type = 'BUY' THEN qty ELSE 0 END)::float8, 0) AS "buyQty",
            COALESCE(SUM(CASE WHEN type = 'BUY' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0) AS "buyCost",
            COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty ELSE 0 END)::float8, 0) AS "sellQty",
            COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty * cost_basis_per_unit ELSE 0 END)::float8, 0) AS "sellCost"
         FROM portfolio_position_transactions
         WHERE user_id = $1 AND upper(symbol) = $2`,
        [resolvedUserId, sym],
      );
      const buyQty = Number(agg.rows?.[0]?.buyQty) || 0;
      const buyCost = Number(agg.rows?.[0]?.buyCost) || 0;
      const sellQty = Number(agg.rows?.[0]?.sellQty) || 0;
      const sellCost = Number(agg.rows?.[0]?.sellCost) || 0;

      const currentQty = baseQty + buyQty - sellQty;
      const currentCost = baseCost + buyCost - sellCost;
      const currentAvgCost = currentQty > 0 ? currentCost / currentQty : 0;

      if (txType === 'SELL') {
        if (currentQty <= 0) throw new Error('No available quantity to sell.');
        if (q > currentQty + 1e-12) throw new Error('Sell quantity exceeds current holding quantity.');
      }

      const sellBasisPerUnit = txType === 'SELL'
        ? (basisOverride != null ? basisOverride : currentAvgCost)
        : null;

      const inserted = await client.query(
        `INSERT INTO portfolio_position_transactions (user_id, symbol, type, tx_date, qty, avg_cost_per_unit, cost_basis_per_unit, notes)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
         RETURNING id`,
        [
          resolvedUserId,
          sym,
          txType,
          date,
          q,
          cost,
          sellBasisPerUnit,
          memo,
        ],
      );

      const cashId = deductId || creditId;
      const cashDelta = txType === 'BUY' ? -total : total;
      if (cashId) {
        const cashRow = await client.query(
          `SELECT id, upper(currency) AS currency, balance
           FROM cash
           WHERE user_id = $1 AND id = $2
           FOR UPDATE`,
          [resolvedUserId, cashId],
        );
        if (cashRow.rowCount === 0) {
          throw new Error('Selected cash item not found.');
        }
        const curr = String(cashRow.rows[0].currency || '').toUpperCase();
        if (isCrypto) {
          // For crypto transactions: only allow stablecoin cash buckets, not USD.
          if (curr !== 'USDT' && curr !== 'USDC') {
            throw new Error('For crypto transactions, the cash item must be USDT or USDC.');
          }
        } else {
          // For non-crypto transactions: allow only USD cash (stocks are USD).
          if (curr !== 'USD') {
            throw new Error('For non-crypto transactions, the cash item must be USD.');
          }
        }
        await client.query(
          `UPDATE cash
           SET balance = balance + $3, updated_at = NOW()
           WHERE user_id = $1 AND id = $2`,
          [resolvedUserId, cashId, cashDelta],
        );
      }

      await client.query('COMMIT');
      return inserted.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { ok: true };
}

export async function deletePositionTransaction({ userId, transactionId }) {
  const resolvedUserId = String(userId || '').trim();
  const id = String(transactionId || '').trim();
  if (!resolvedUserId || !id) throw new Error('Missing user id or transaction id.');
  const result = await query(
    `DELETE FROM portfolio_position_transactions
     WHERE user_id = $1 AND id = $2
     RETURNING id`,
    [resolvedUserId, id],
  );
  if (result.rowCount === 0) throw new Error('Transaction not found.');
  return { ok: true };
}

export async function listHistoricalSaleTransactions(userId, symbol) {
  const resolvedUserId = String(userId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!sym) return [];
  const result = await query(
    `SELECT id,
            to_char(tx_date, 'YYYY-MM-DD') AS "txDate",
            qty::float8 AS qty,
            avg_cost_per_unit::float8 AS "sellPricePerUnit",
            cost_basis_per_unit::float8 AS "costBasisPerUnit",
            notes,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS "createdAtUtc"
     FROM portfolio_position_transactions
     WHERE user_id = $1
       AND upper(symbol) = $2
       AND type = 'SELL'
       AND affects_holdings = FALSE
     ORDER BY tx_date DESC, created_at DESC`,
    [resolvedUserId, sym],
  );
  return result.rows;
}

export async function importHistoricalSaleTransactions({ userId, symbol, rows }) {
  const resolvedUserId = String(userId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!sym) throw new Error('Symbol is required.');
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    throw new Error('No rows to import.');
  }

  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const positionRow = await client.query(
        `SELECT 1 FROM portfolio_positions WHERE user_id = $1 AND symbol = $2`,
        [resolvedUserId, sym],
      );
      if (positionRow.rowCount === 0) {
        throw new Error('Position not found.');
      }

      for (const [index, raw] of list.entries()) {
        const txDate = String(raw?.txDate || '').trim();
        const qty = Number(raw?.qty);
        const sellPricePerUnit = Number(raw?.sellPricePerUnit);
        const costBasisPerUnit = Number(raw?.costBasisPerUnit);
        const notes = raw?.notes == null ? null : String(raw.notes).trim() || null;

        if (!txDate) throw new Error(`Row ${index + 1}: txDate is required (YYYY-MM-DD).`);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Row ${index + 1}: qty must be > 0.`);
        if (!Number.isFinite(sellPricePerUnit) || sellPricePerUnit < 0) {
          throw new Error(`Row ${index + 1}: sellPricePerUnit must be >= 0.`);
        }
        if (!Number.isFinite(costBasisPerUnit) || costBasisPerUnit < 0) {
          throw new Error(`Row ${index + 1}: costBasisPerUnit must be >= 0.`);
        }

        await client.query(
          `INSERT INTO portfolio_position_transactions (
            user_id,
            symbol,
            type,
            affects_holdings,
            tx_date,
            qty,
            avg_cost_per_unit,
            cost_basis_per_unit,
            notes
          )
          VALUES ($1, $2, 'SELL', FALSE, $3::date, $4, $5, $6, $7)`,
          [resolvedUserId, sym, txDate, qty, sellPricePerUnit, costBasisPerUnit, notes],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return { ok: true, imported: list.length };
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

  return withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const deletedTx = await client.query(
        `DELETE FROM portfolio_position_transactions
         WHERE user_id = $1 AND upper(symbol) = $2
         RETURNING id`,
        [resolvedUserId, normalizedSymbol],
      );

      const deletedPos = await client.query(
        `DELETE FROM portfolio_positions
         WHERE user_id = $1 AND symbol = $2
         RETURNING symbol`,
        [resolvedUserId, normalizedSymbol],
      );

      if (deletedPos.rowCount === 0) {
        throw new Error(`Position not found for ${normalizedSymbol}.`);
      }

      await client.query('COMMIT');
      return { symbol: normalizedSymbol, deletedTransactions: deletedTx.rowCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
