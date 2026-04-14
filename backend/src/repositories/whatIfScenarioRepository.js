import { query, withTransaction } from '../db/client.js';

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeCurrency(currency) {
  const cur = String(currency || '').trim().toUpperCase();
  return cur || null;
}

const MAX_HYPOTHETICAL_COMMENT_LEN = 2000;

function normalizeHypotheticalComment(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return s.length > MAX_HYPOTHETICAL_COMMENT_LEN ? s.slice(0, MAX_HYPOTHETICAL_COMMENT_LEN) : s;
}

function normalizeTargetPriceInputRows(resolvedRows) {
  const bySymbol = new Map();
  resolvedRows.forEach((item, index) => {
    const symbol = normalizeSymbol(item?.symbol);
    const targetPrice = Number(item?.targetPrice);
    const targetPrice2Raw = item?.targetPrice2;
    const targetPrice2 =
      targetPrice2Raw == null || targetPrice2Raw === '' ? 0 : Number(targetPrice2Raw);
    const currency = normalizeCurrency(item?.currency);
    if (!symbol) throw new Error(`Target price row ${index + 1}: symbol is required.`);
    if (!Number.isFinite(targetPrice) || targetPrice < 0) {
      throw new Error(`Target price row ${index + 1}: targetPrice must be 0 or greater.`);
    }
    if (!Number.isFinite(targetPrice2) || targetPrice2 < 0) {
      throw new Error(`Target price row ${index + 1}: targetPrice2 must be 0 or greater.`);
    }
    bySymbol.set(symbol, { symbol, targetPrice, targetPrice2, currency });
  });
  return Array.from(bySymbol.values());
}

function normalizeHypotheticalPurchaseInputRows(resolvedRows) {
  return resolvedRows.map((item, index) => {
    if (item != null && item.sellPrice != null && item.sellPrice !== '') {
      throw new Error(
        `Hypothetical buy row ${index + 1}: sellPrice is not allowed on buy rows (use hypothetical sales).`,
      );
    }
    const symbol = normalizeSymbol(item?.symbol);
    const qty = Number(item?.qty);
    const buyPrice = Number(item?.buyPrice);
    const currency = normalizeCurrency(item?.currency);
    if (!symbol) throw new Error(`Hypothetical buy row ${index + 1}: symbol is required.`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Hypothetical buy row ${index + 1}: qty must be > 0.`);
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      throw new Error(`Hypothetical buy row ${index + 1}: buyPrice must be 0 or greater.`);
    }
    const comment = normalizeHypotheticalComment(item?.comment);
    return { symbol, qty, buyPrice, currency, comment };
  });
}

function normalizeHypotheticalSaleInputRows(resolvedRows) {
  return resolvedRows.map((item, index) => {
    const symbol = normalizeSymbol(item?.symbol);
    const qty = Number(item?.qty);
    const sellPrice = Number(item?.sellPrice);
    const feeRaw = item?.feeFlat;
    const feeFlat = feeRaw == null || feeRaw === '' ? null : Number(feeRaw);
    const currency = normalizeCurrency(item?.currency);
    if (!symbol) throw new Error(`Hypothetical sale row ${index + 1}: symbol is required.`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Hypothetical sale row ${index + 1}: qty must be > 0.`);
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      throw new Error(`Hypothetical sale row ${index + 1}: sellPrice must be 0 or greater.`);
    }
    if (feeFlat != null && (!Number.isFinite(feeFlat) || feeFlat < 0)) {
      throw new Error(`Hypothetical sale row ${index + 1}: feeFlat must be 0 or greater when provided.`);
    }
    const comment = normalizeHypotheticalComment(item?.comment);
    return { symbol, qty, sellPrice, feeFlat, currency, comment };
  });
}

export async function listWhatIfScenarios(userId) {
  const resolvedUserId = String(userId || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  const result = await query(
    `SELECT id,
            name,
            is_active AS "isActive",
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtUtc",
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAtUtc"
     FROM whatif_scenarios
     WHERE user_id = $1
     ORDER BY is_active DESC, updated_at DESC, created_at DESC`,
    [resolvedUserId],
  );
  return result.rows;
}

function isUniqueViolation(error) {
  return Boolean(error && error.code === '23505');
}

export async function createWhatIfScenario({ userId, name, makeActive = false }) {
  const resolvedUserId = String(userId || '').trim();
  const scenarioName = String(name || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!scenarioName) throw new Error('Scenario name is required.');
  if (scenarioName.length > 120) throw new Error('Scenario name must be 120 chars or fewer.');

  return withTransaction(async (client) => {
    if (makeActive) {
      await client.query(`UPDATE whatif_scenarios SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1`, [
        resolvedUserId,
      ]);
    }
    let result;
    try {
      result = await client.query(
        `INSERT INTO whatif_scenarios (user_id, name, is_active)
         VALUES ($1, $2, $3)
         RETURNING id,
                   name,
                   is_active AS "isActive",
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtUtc",
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAtUtc"`,
        [resolvedUserId, scenarioName, Boolean(makeActive)],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error('A scenario with this name already exists.');
      }
      throw error;
    }
    return result.rows[0];
  });
}

/**
 * Copies target prices, hypothetical purchases, and hypothetical sales into a new scenario.
 * Name must be unique per user (case-insensitive), same as create.
 */
export async function duplicateWhatIfScenario({ userId, sourceScenarioId, name, makeActive = true }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedSourceId = String(sourceScenarioId || '').trim();
  const scenarioName = String(name || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!resolvedSourceId) throw new Error('Missing scenario id.');
  if (!scenarioName) throw new Error('Scenario name is required.');
  if (scenarioName.length > 120) throw new Error('Scenario name must be 120 chars or fewer.');

  return withTransaction(async (client) => {
    const found = await client.query(`SELECT id FROM whatif_scenarios WHERE user_id = $1 AND id = $2`, [
      resolvedUserId,
      resolvedSourceId,
    ]);
    if (found.rowCount === 0) throw new Error('Scenario not found.');

    const targets = await client.query(
      `SELECT symbol, target_price, target_price_2, currency
       FROM whatif_target_prices
       WHERE scenario_id = $1
       ORDER BY symbol ASC`,
      [resolvedSourceId],
    );
    const purchases = await client.query(
      `SELECT symbol, qty, buy_price, currency, comment_text
       FROM whatif_hypothetical_purchases
       WHERE scenario_id = $1
       ORDER BY created_at ASC`,
      [resolvedSourceId],
    );
    const sales = await client.query(
      `SELECT symbol, qty, sell_price, fee_flat, currency, comment_text
       FROM whatif_hypothetical_sales
       WHERE scenario_id = $1
       ORDER BY created_at ASC`,
      [resolvedSourceId],
    );

    if (makeActive) {
      await client.query(`UPDATE whatif_scenarios SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1`, [
        resolvedUserId,
      ]);
    }

    let ins;
    try {
      ins = await client.query(
        `INSERT INTO whatif_scenarios (user_id, name, is_active)
         VALUES ($1, $2, $3)
         RETURNING id,
                   name,
                   is_active AS "isActive",
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtUtc",
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAtUtc"`,
        [resolvedUserId, scenarioName, Boolean(makeActive)],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error('A scenario with this name already exists.');
      }
      throw error;
    }

    const newId = ins.rows[0].id;

    for (const row of targets.rows) {
      await client.query(
        `INSERT INTO whatif_target_prices (scenario_id, symbol, target_price, target_price_2, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          newId,
          normalizeSymbol(row.symbol),
          Number(row.target_price),
          Number(row.target_price_2) || 0,
          normalizeCurrency(row.currency),
        ],
      );
    }
    for (const row of purchases.rows) {
      await client.query(
        `INSERT INTO whatif_hypothetical_purchases (scenario_id, symbol, qty, buy_price, currency, comment_text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newId,
          normalizeSymbol(row.symbol),
          Number(row.qty),
          Number(row.buy_price),
          normalizeCurrency(row.currency),
          row.comment_text == null || String(row.comment_text).trim() === '' ? null : String(row.comment_text).trim(),
        ],
      );
    }
    for (const row of sales.rows) {
      await client.query(
        `INSERT INTO whatif_hypothetical_sales (scenario_id, symbol, qty, sell_price, fee_flat, currency, comment_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newId,
          normalizeSymbol(row.symbol),
          Number(row.qty),
          Number(row.sell_price),
          row.fee_flat == null ? null : Number(row.fee_flat),
          normalizeCurrency(row.currency),
          row.comment_text == null || String(row.comment_text).trim() === '' ? null : String(row.comment_text).trim(),
        ],
      );
    }

    return ins.rows[0];
  });
}

export async function updateWhatIfScenario({ userId, scenarioId, name }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedScenarioId = String(scenarioId || '').trim();
  const scenarioName = String(name || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!resolvedScenarioId) throw new Error('Missing scenario id.');
  if (!scenarioName) throw new Error('Scenario name is required.');
  if (scenarioName.length > 120) throw new Error('Scenario name must be 120 chars or fewer.');

  let result;
  try {
    result = await query(
      `UPDATE whatif_scenarios
       SET name = $3,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $1
       RETURNING id, name, is_active AS "isActive"`,
      [resolvedUserId, resolvedScenarioId, scenarioName],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error('A scenario with this name already exists.');
    }
    throw error;
  }
  if (result.rowCount === 0) throw new Error('Scenario not found.');
  return result.rows[0];
}

export async function setWhatIfScenarioActive({ userId, scenarioId }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedScenarioId = String(scenarioId || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!resolvedScenarioId) throw new Error('Missing scenario id.');
  return withTransaction(async (client) => {
    const found = await client.query(`SELECT id FROM whatif_scenarios WHERE user_id = $1 AND id = $2`, [
      resolvedUserId,
      resolvedScenarioId,
    ]);
    if (found.rowCount === 0) throw new Error('Scenario not found.');
    await client.query(`UPDATE whatif_scenarios SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1`, [
      resolvedUserId,
    ]);
    await client.query(`UPDATE whatif_scenarios SET is_active = TRUE, updated_at = NOW() WHERE user_id = $1 AND id = $2`, [
      resolvedUserId,
      resolvedScenarioId,
    ]);
    return { ok: true };
  });
}

export async function deleteWhatIfScenario({ userId, scenarioId }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedScenarioId = String(scenarioId || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!resolvedScenarioId) throw new Error('Missing scenario id.');
  const result = await query(`DELETE FROM whatif_scenarios WHERE user_id = $1 AND id = $2 RETURNING id`, [
    resolvedUserId,
    resolvedScenarioId,
  ]);
  if (result.rowCount === 0) throw new Error('Scenario not found.');
  return { ok: true };
}

export async function getWhatIfScenarioById({ userId, scenarioId }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedScenarioId = String(scenarioId || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!resolvedScenarioId) throw new Error('Missing scenario id.');
  const result = await query(
    `SELECT id,
            user_id AS "userId",
            name,
            is_active AS "isActive"
     FROM whatif_scenarios
     WHERE user_id = $1 AND id = $2`,
    [resolvedUserId, resolvedScenarioId],
  );
  return result.rows[0] || null;
}

export async function listWhatIfTargetPrices({ userId, scenarioId }) {
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const result = await query(
    `SELECT symbol,
            target_price::float8 AS "targetPrice",
            COALESCE(target_price_2, 0)::float8 AS "targetPrice2",
            COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency
     FROM whatif_target_prices
     WHERE scenario_id = $1
     ORDER BY symbol ASC`,
    [scenarioId],
  );
  return result.rows.map((row) => ({
    symbol: normalizeSymbol(row.symbol),
    targetPrice: Number(row.targetPrice) || 0,
    targetPrice2: Number(row.targetPrice2) || 0,
    currency: normalizeCurrency(row.currency),
  }));
}

export async function replaceWhatIfTargetPrices({ userId, scenarioId, rows }) {
  const resolvedRows = Array.isArray(rows) ? rows : [];
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const normalized = normalizeTargetPriceInputRows(resolvedRows);

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_target_prices WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalized) {
      await client.query(
        `INSERT INTO whatif_target_prices (scenario_id, symbol, target_price, target_price_2, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [scenarioId, row.symbol, row.targetPrice, row.targetPrice2, row.currency],
      );
    }
    await client.query(`UPDATE whatif_scenarios SET updated_at = NOW() WHERE id = $1`, [scenarioId]);
    return normalized;
  });
}

export async function listWhatIfHypotheticalPurchases({ userId, scenarioId }) {
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const result = await query(
    `SELECT id,
            symbol,
            qty::float8 AS qty,
            buy_price::float8 AS "buyPrice",
            COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency,
            NULLIF(TRIM(comment_text), '') AS comment
     FROM whatif_hypothetical_purchases
     WHERE scenario_id = $1
     ORDER BY created_at ASC`,
    [scenarioId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    symbol: normalizeSymbol(row.symbol),
    qty: Number(row.qty) || 0,
    buyPrice: Number(row.buyPrice) || 0,
    currency: normalizeCurrency(row.currency),
    comment: row.comment == null ? null : String(row.comment),
  }));
}

export async function replaceWhatIfHypotheticalPurchases({ userId, scenarioId, rows }) {
  const resolvedRows = Array.isArray(rows) ? rows : [];
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const normalized = normalizeHypotheticalPurchaseInputRows(resolvedRows);

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_hypothetical_purchases WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalized) {
      await client.query(
        `INSERT INTO whatif_hypothetical_purchases (scenario_id, symbol, qty, buy_price, currency, comment_text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [scenarioId, row.symbol, row.qty, row.buyPrice, row.currency, row.comment],
      );
    }
    await client.query(`UPDATE whatif_scenarios SET updated_at = NOW() WHERE id = $1`, [scenarioId]);
    return normalized;
  });
}

/**
 * Replaces target prices, hypothetical buys, and hypothetical sales in one transaction.
 * Prevents unique-key races from parallel per-table replaces or overlapping PUT /inputs requests.
 */
export async function replaceWhatIfScenarioInputs({ userId, scenarioId, targetRows, buyRows, saleRows }) {
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const normalizedTargets = normalizeTargetPriceInputRows(Array.isArray(targetRows) ? targetRows : []);
  const normalizedPurchases = normalizeHypotheticalPurchaseInputRows(Array.isArray(buyRows) ? buyRows : []);
  const normalizedSales = normalizeHypotheticalSaleInputRows(Array.isArray(saleRows) ? saleRows : []);

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_target_prices WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalizedTargets) {
      await client.query(
        `INSERT INTO whatif_target_prices (scenario_id, symbol, target_price, target_price_2, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [scenarioId, row.symbol, row.targetPrice, row.targetPrice2, row.currency],
      );
    }
    await client.query(`DELETE FROM whatif_hypothetical_purchases WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalizedPurchases) {
      await client.query(
        `INSERT INTO whatif_hypothetical_purchases (scenario_id, symbol, qty, buy_price, currency, comment_text)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [scenarioId, row.symbol, row.qty, row.buyPrice, row.currency, row.comment],
      );
    }
    await client.query(`DELETE FROM whatif_hypothetical_sales WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalizedSales) {
      await client.query(
        `INSERT INTO whatif_hypothetical_sales (scenario_id, symbol, qty, sell_price, fee_flat, currency, comment_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [scenarioId, row.symbol, row.qty, row.sellPrice, row.feeFlat, row.currency, row.comment],
      );
    }
    await client.query(`UPDATE whatif_scenarios SET updated_at = NOW() WHERE id = $1`, [scenarioId]);
    return {
      targetPrices: normalizedTargets,
      hypotheticalPurchases: normalizedPurchases,
      hypotheticalSales: normalizedSales,
    };
  });
}

export async function listWhatIfHypotheticalSales({ userId, scenarioId }) {
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const result = await query(
    `SELECT id,
            symbol,
            qty::float8 AS qty,
            sell_price::float8 AS "sellPrice",
            fee_flat::float8 AS "feeFlat",
            COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency,
            NULLIF(TRIM(comment_text), '') AS comment
     FROM whatif_hypothetical_sales
     WHERE scenario_id = $1
     ORDER BY created_at ASC`,
    [scenarioId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    symbol: normalizeSymbol(row.symbol),
    qty: Number(row.qty) || 0,
    sellPrice: Number(row.sellPrice) || 0,
    feeFlat: row.feeFlat == null ? null : Number(row.feeFlat),
    currency: normalizeCurrency(row.currency),
    comment: row.comment == null ? null : String(row.comment),
  }));
}

export async function replaceWhatIfHypotheticalSales({ userId, scenarioId, rows }) {
  const resolvedRows = Array.isArray(rows) ? rows : [];
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');
  const normalized = normalizeHypotheticalSaleInputRows(resolvedRows);

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_hypothetical_sales WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalized) {
      await client.query(
        `INSERT INTO whatif_hypothetical_sales (scenario_id, symbol, qty, sell_price, fee_flat, currency, comment_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [scenarioId, row.symbol, row.qty, row.sellPrice, row.feeFlat, row.currency, row.comment],
      );
    }
    await client.query(`UPDATE whatif_scenarios SET updated_at = NOW() WHERE id = $1`, [scenarioId]);
    return normalized;
  });
}
