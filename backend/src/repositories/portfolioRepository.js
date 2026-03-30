import { query, withTransaction } from '../db/client.js';
import { findCoinbaseProduct, findCoinbaseQuoteCurrenciesByIds } from './marketReferenceRepository.js';
import { computePositionTxCashReverseDelta } from '../services/portfolioCashAdjustments.js';

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
            (
              COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0)
              -
              COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN COALESCE(fee_flat_total, COALESCE(fee_per_unit, 0) * qty) ELSE 0 END)::float8, 0)
            ) AS "holdingSellProceeds",
            COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty * cost_basis_per_unit ELSE 0 END)::float8, 0) AS "holdingSellCost",
            COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty ELSE 0 END)::float8, 0) AS "realizedSellQty",
            (
              COALESCE(SUM(CASE WHEN type = 'SELL' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0)
              -
              COALESCE(SUM(CASE WHEN type = 'SELL' THEN COALESCE(fee_flat_total, COALESCE(fee_per_unit, 0) * qty) ELSE 0 END)::float8, 0)
            ) AS "realizedSellProceeds",
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
            COALESCE(fee_flat_total::float8, (COALESCE(fee_per_unit, 0)::float8 * qty::float8)) AS "feeFlat",
            deduct_cash_id AS "deductCashId",
            credit_cash_id AS "creditCashId",
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

/**
 * List all position transactions for a user (BUY/SELL, including imported sells).
 * @param {string} userId
 * @param {{ from?: string|null, to?: string|null }} [options]
 * @returns {Promise<object[]>}
 */
export async function listAllPositionTransactions(userId, { from = null, to = null } = {}) {
  const resolvedUserId = String(userId || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  const fromDate = from ? String(from).trim() : '';
  const toDate = to ? String(to).trim() : '';

  const filters = ['user_id = $1'];
  const params = [resolvedUserId];

  if (fromDate) {
    params.push(fromDate);
    filters.push(`tx_date >= $${params.length}::date`);
  }
  if (toDate) {
    params.push(toDate);
    filters.push(`tx_date <= $${params.length}::date`);
  }

  const result = await query(
    `SELECT id,
            upper(symbol) AS symbol,
            upper(type) AS type,
            affects_holdings AS "affectsHoldings",
            to_char(tx_date, 'YYYY-MM-DD') AS "txDate",
            qty::float8 AS qty,
            avg_cost_per_unit::float8 AS "avgCostPerUnit",
            COALESCE(fee_flat_total::float8, (COALESCE(fee_per_unit, 0)::float8 * qty::float8)) AS "feeFlat",
            cost_basis_per_unit::float8 AS "costBasisPerUnit",
            notes,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtUtc"
     FROM portfolio_position_transactions
     WHERE ${filters.join(' AND ')}
     ORDER BY tx_date ASC, created_at ASC`,
    params,
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
  feeFlatTotal = null,
  feePerUnit = null, // legacy
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
  const feePerUnitNum = feePerUnit == null ? null : Number(feePerUnit);
  const feeFlatNum = feeFlatTotal == null ? null : Number(feeFlatTotal);
  const fee =
    feeFlatNum != null ? feeFlatNum : feePerUnitNum != null ? feePerUnitNum * q : null;
  const memo = notes == null ? null : String(notes).trim() || null;
  const deductId = deductCashId ? String(deductCashId).trim() : null;
  const creditId = creditCashId ? String(creditCashId).trim() : null;

  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!sym) throw new Error('Symbol is required.');
  if (!date) throw new Error('Transaction date is required.');
  if (!Number.isFinite(q) || q <= 0) throw new Error('Quantity must be greater than 0.');
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Average cost per unit must be 0 or greater.');
  if (fee != null && (!Number.isFinite(fee) || fee < 0)) throw new Error('Fee must be 0 or greater.');
  if (txType !== 'BUY' && txType !== 'SELL') throw new Error('Transaction type must be BUY or SELL.');
  if (deductId && creditId) throw new Error('Choose either deductCashId or creditCashId, not both.');
  if (txType === 'SELL' && basisOverride != null && (!Number.isFinite(basisOverride) || basisOverride < 0)) {
    throw new Error('Cost basis per unit must be 0 or greater.');
  }
  if (txType === 'SELL' && basisOverride != null) {
    throw new Error('Overriding cost basis per unit is not allowed for sells.');
  }

  const total = q * cost;
  const totalFee = fee == null ? 0 : fee;

  await withTransaction(async (client) => {
    const positionRow = await client.query(
      `SELECT category, upper(currency) AS currency, qty::float8 AS qty, purchase_price::float8 AS "purchasePrice"
       FROM portfolio_positions
       WHERE user_id = $1 AND symbol = $2`,
      [resolvedUserId, sym],
    );
    if (positionRow.rowCount === 0) {
      throw new Error('Position not found.');
    }
    const positionCurrency = String(positionRow.rows[0].currency || 'USD').toUpperCase();
    const baseQty = Number(positionRow.rows[0].qty) || 0;
    const baseAvg = Number(positionRow.rows[0].purchasePrice) || 0;
    const baseCost = baseQty * baseAvg;

    const agg = await client.query(
      `SELECT
          COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'BUY' THEN qty ELSE 0 END)::float8, 0) AS "buyQty",
          COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'BUY' THEN qty * avg_cost_per_unit ELSE 0 END)::float8, 0) AS "buyCost",
          COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty ELSE 0 END)::float8, 0) AS "sellQty",
          COALESCE(SUM(CASE WHEN affects_holdings = TRUE AND type = 'SELL' THEN qty * cost_basis_per_unit ELSE 0 END)::float8, 0) AS "sellCost"
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

    const sellBasisPerUnit = txType === 'SELL' ? currentAvgCost : null;

    await client.query(
      `INSERT INTO portfolio_position_transactions (
          user_id,
          symbol,
          type,
          tx_date,
          qty,
          avg_cost_per_unit,
          fee_per_unit,
          fee_flat_total,
          deduct_cash_id,
          credit_cash_id,
          cost_basis_per_unit,
          notes
        )
       VALUES ($1, $2, $3, $4::date, $5, $6, NULL, $7, $8, $9, $10, $11)
       RETURNING id`,
      [resolvedUserId, sym, txType, date, q, cost, fee, deductId, creditId, sellBasisPerUnit, memo],
    );

    const cashId = deductId || creditId;
    const cashDelta = txType === 'BUY' ? -(total + totalFee) : total - totalFee;
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
      if (positionCurrency === 'USDT' || positionCurrency === 'USDC') {
        if (curr !== 'USDT' && curr !== 'USDC') {
          throw new Error('This asset is USDT/USDC-based, so the cash item must be USDT or USDC.');
        }
      } else if (curr !== positionCurrency) {
        throw new Error(`Cash currency mismatch: expected ${positionCurrency} for ${sym}.`);
      }
      await client.query(
        `UPDATE cash
         SET balance = balance + $3, updated_at = NOW()
         WHERE user_id = $1 AND id = $2`,
        [resolvedUserId, cashId, cashDelta],
      );
    }
  });

  return { ok: true };
}

export async function deletePositionTransaction({ userId, transactionId, adjustCash = false }) {
  const resolvedUserId = String(userId || '').trim();
  const id = String(transactionId || '').trim();
  if (!resolvedUserId || !id) throw new Error('Missing user id or transaction id.');
  return await withTransaction(async (client) => {
    const txRow = await client.query(
      `SELECT id,
              upper(symbol) AS symbol,
              upper(type) AS type,
              qty::float8 AS qty,
              avg_cost_per_unit::float8 AS "avgCostPerUnit",
              COALESCE(fee_flat_total::float8, (COALESCE(fee_per_unit, 0)::float8 * qty::float8)) AS "feeFlat",
              deduct_cash_id AS "deductCashId",
              credit_cash_id AS "creditCashId"
       FROM portfolio_position_transactions
       WHERE user_id = $1 AND id = $2
       FOR UPDATE`,
      [resolvedUserId, id],
    );
    if (txRow.rowCount === 0) throw new Error('Transaction not found.');
    const tx = txRow.rows[0];

    // Delete first; cash reversal is best-effort only when linked cash exists.
    await client.query(
      `DELETE FROM portfolio_position_transactions
       WHERE user_id = $1 AND id = $2`,
      [resolvedUserId, id],
    );

    const cashId = tx.deductCashId || tx.creditCashId;
    const hasCashLink = Boolean(cashId);
    if (adjustCash && hasCashLink) {
      // Silent skip if cash account no longer exists (requested behavior).
      const cashRow = await client.query(
        `SELECT id, upper(currency) AS currency
         FROM cash
         WHERE user_id = $1 AND id = $2
         FOR UPDATE`,
        [resolvedUserId, cashId],
      );
      if (cashRow.rowCount > 0) {
        const positionCurrencyRow = await client.query(
          `SELECT upper(currency) AS currency
           FROM portfolio_positions
           WHERE user_id = $1 AND upper(symbol) = $2`,
          [resolvedUserId, String(tx.symbol || '').toUpperCase()],
        );
        const positionCurrency = String(positionCurrencyRow.rows?.[0]?.currency || 'USD').toUpperCase();
        const cashCurrency = String(cashRow.rows[0].currency || '').toUpperCase();
        if (positionCurrency === 'USDT' || positionCurrency === 'USDC') {
          if (cashCurrency !== 'USDT' && cashCurrency !== 'USDC') {
            throw new Error('This asset is USDT/USDC-based, so the cash item must be USDT or USDC.');
          }
        } else if (cashCurrency !== positionCurrency) {
          throw new Error(`Cash currency mismatch: expected ${positionCurrency} for ${tx.symbol}.`);
        }

        const reverseDelta = computePositionTxCashReverseDelta({
          type: tx.type,
          qty: tx.qty,
          pricePerUnit: tx.avgCostPerUnit,
          feeFlat: tx.feeFlat,
        });

        if (Number.isFinite(reverseDelta) && Math.abs(reverseDelta) > 1e-12) {
          await client.query(
            `UPDATE cash
             SET balance = balance + $3, updated_at = NOW()
             WHERE user_id = $1 AND id = $2`,
            [resolvedUserId, cashId, reverseDelta],
          );
        }
      }
    }

    return {
      ok: true,
      deleted: {
        id: tx.id,
        symbol: tx.symbol,
        type: tx.type,
        deductCashId: tx.deductCashId,
        creditCashId: tx.creditCashId,
      },
    };
  });
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
            COALESCE(fee_flat_total::float8, (COALESCE(fee_per_unit, 0)::float8 * qty::float8)) AS "feeFlat",
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

  await withTransaction(async (client) => {
    const positionRow = await client.query(`SELECT 1 FROM portfolio_positions WHERE user_id = $1 AND symbol = $2`, [
      resolvedUserId,
      sym,
    ]);
    if (positionRow.rowCount === 0) {
      throw new Error('Position not found.');
    }

    for (const [index, raw] of list.entries()) {
      const txDate = String(raw?.txDate || '').trim();
      const qty = Number(raw?.qty);
      const sellPricePerUnit = Number(raw?.sellPricePerUnit);
      const feeFlatRaw = raw?.feeFlatTotal ?? raw?.feeFlat ?? null;
      const feePerUnitRaw = raw?.feePerUnit == null ? null : Number(raw?.feePerUnit);
      const feeFlat = feeFlatRaw == null ? (feePerUnitRaw == null ? null : feePerUnitRaw * qty) : Number(feeFlatRaw);
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
      if (feeFlat != null && (!Number.isFinite(feeFlat) || feeFlat < 0)) {
        throw new Error(`Row ${index + 1}: feeFlat must be >= 0.`);
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
          fee_per_unit,
          fee_flat_total,
          cost_basis_per_unit,
          notes
        )
        VALUES ($1, $2, 'SELL', FALSE, $3::date, $4, $5, NULL, $6, $7, $8)`,
        [resolvedUserId, sym, txDate, qty, sellPricePerUnit, feeFlat, costBasisPerUnit, notes],
      );
    }
  });

  return { ok: true, imported: list.length };
}

export async function clearHistoricalSaleTransactions({ userId, symbol }) {
  const resolvedUserId = String(userId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!sym) throw new Error('Symbol is required.');
  const result = await query(
    `DELETE FROM portfolio_position_transactions
     WHERE user_id = $1
       AND upper(symbol) = $2
       AND type = 'SELL'
       AND affects_holdings = FALSE
     RETURNING id`,
    [resolvedUserId, sym],
  );
  return { ok: true, deleted: result.rowCount || 0 };
}

export async function getHistoricalSaleCount(userId, symbol) {
  const resolvedUserId = String(userId || '').trim();
  const sym = String(symbol || '').trim().toUpperCase();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!sym) return 0;
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM portfolio_position_transactions
     WHERE user_id = $1
       AND upper(symbol) = $2
       AND type = 'SELL'
       AND affects_holdings = FALSE`,
    [resolvedUserId, sym],
  );
  return Number(result?.rows?.[0]?.count) || 0;
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

  await withTransaction(async (client) => {
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
  });
}

export async function createCryptoPositionFromCoinbaseProduct({ userId, productId, qty, avgCostPerUnit }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedQty = Number(qty);
  const resolvedCost = Number(avgCostPerUnit);
  if (!resolvedUserId) {
    throw new Error('Missing user id.');
  }
  if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
    if (resolvedQty === 0) {
      // Allow placeholder positions with 0 initial quantity (e.g. for importing realized history).
    } else {
      throw new Error('Quantity must be 0 or greater.');
    }
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

  await withTransaction(async (client) => {
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
    if (resolvedQty === 0) {
      // Allow placeholder positions with 0 initial quantity (e.g. for importing realized history).
    } else {
      throw new Error('Quantity must be 0 or greater.');
    }
  }
  if (!Number.isFinite(resolvedCost) || resolvedCost < 0) {
    throw new Error('Average cost per unit must be 0 or greater.');
  }

  await withTransaction(async (client) => {
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
  });

  return { symbol: normalizedSymbol };
}

export async function updatePosition({ userId, symbol, qty, avgCostPerUnit }) {
  const resolvedUserId = String(userId || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const resolvedQty = Number(qty);
  const resolvedCost = Number(avgCostPerUnit);

  if (!resolvedUserId || !normalizedSymbol) {
    throw new Error('User id and symbol are required.');
  }
  if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
    if (resolvedQty === 0) {
      // Allow placeholder positions with 0 initial quantity (e.g. for importing realized history).
    } else {
      throw new Error('Quantity must be 0 or greater.');
    }
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

export async function deletePosition(userId, symbol) {
  const resolvedUserId = String(userId || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!resolvedUserId || !normalizedSymbol) {
    throw new Error('User id and symbol are required.');
  }

  return withTransaction(async (client) => {
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

    return { symbol: normalizedSymbol, deletedTransactions: deletedTx.rowCount };
  });
}
