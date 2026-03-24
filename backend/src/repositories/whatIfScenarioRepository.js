import { query, withTransaction } from '../db/client.js';

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeCurrency(currency) {
  const cur = String(currency || '').trim().toUpperCase();
  return cur || null;
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
    const result = await client.query(
      `INSERT INTO whatif_scenarios (user_id, name, is_active)
       VALUES ($1, $2, $3)
       RETURNING id,
                 name,
                 is_active AS "isActive",
                 to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtUtc",
                 to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAtUtc"`,
      [resolvedUserId, scenarioName, Boolean(makeActive)],
    );
    return result.rows[0];
  });
}

export async function updateWhatIfScenario({ userId, scenarioId, name }) {
  const resolvedUserId = String(userId || '').trim();
  const resolvedScenarioId = String(scenarioId || '').trim();
  const scenarioName = String(name || '').trim();
  if (!resolvedUserId) throw new Error('Missing user id.');
  if (!resolvedScenarioId) throw new Error('Missing scenario id.');
  if (!scenarioName) throw new Error('Scenario name is required.');

  const result = await query(
    `UPDATE whatif_scenarios
     SET name = $3,
         updated_at = NOW()
     WHERE id = $2 AND user_id = $1
     RETURNING id, name, is_active AS "isActive"`,
    [resolvedUserId, resolvedScenarioId, scenarioName],
  );
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
            COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency
     FROM whatif_target_prices
     WHERE scenario_id = $1
     ORDER BY symbol ASC`,
    [scenarioId],
  );
  return result.rows.map((row) => ({
    symbol: normalizeSymbol(row.symbol),
    targetPrice: Number(row.targetPrice) || 0,
    currency: normalizeCurrency(row.currency),
  }));
}

export async function replaceWhatIfTargetPrices({ userId, scenarioId, rows }) {
  const resolvedRows = Array.isArray(rows) ? rows : [];
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');

  const normalized = resolvedRows.map((item, index) => {
    const symbol = normalizeSymbol(item?.symbol);
    const targetPrice = Number(item?.targetPrice);
    const currency = normalizeCurrency(item?.currency);
    if (!symbol) throw new Error(`Target price row ${index + 1}: symbol is required.`);
    if (!Number.isFinite(targetPrice) || targetPrice < 0) {
      throw new Error(`Target price row ${index + 1}: targetPrice must be 0 or greater.`);
    }
    return { symbol, targetPrice, currency };
  });

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_target_prices WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalized) {
      await client.query(
        `INSERT INTO whatif_target_prices (scenario_id, symbol, target_price, currency)
         VALUES ($1, $2, $3, $4)`,
        [scenarioId, row.symbol, row.targetPrice, row.currency],
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
            COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency
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
  }));
}

export async function replaceWhatIfHypotheticalPurchases({ userId, scenarioId, rows }) {
  const resolvedRows = Array.isArray(rows) ? rows : [];
  const scenario = await getWhatIfScenarioById({ userId, scenarioId });
  if (!scenario) throw new Error('Scenario not found.');

  const normalized = resolvedRows.map((item, index) => {
    const symbol = normalizeSymbol(item?.symbol);
    const qty = Number(item?.qty);
    const buyPrice = Number(item?.buyPrice);
    const currency = normalizeCurrency(item?.currency);
    if (!symbol) throw new Error(`Hypothetical purchase row ${index + 1}: symbol is required.`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Hypothetical purchase row ${index + 1}: qty must be > 0.`);
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      throw new Error(`Hypothetical purchase row ${index + 1}: buyPrice must be 0 or greater.`);
    }
    return { symbol, qty, buyPrice, currency };
  });

  return withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_hypothetical_purchases WHERE scenario_id = $1`, [scenarioId]);
    for (const row of normalized) {
      await client.query(
        `INSERT INTO whatif_hypothetical_purchases (scenario_id, symbol, qty, buy_price, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [scenarioId, row.symbol, row.qty, row.buyPrice, row.currency],
      );
    }
    await client.query(`UPDATE whatif_scenarios SET updated_at = NOW() WHERE id = $1`, [scenarioId]);
    return normalized;
  });
}
