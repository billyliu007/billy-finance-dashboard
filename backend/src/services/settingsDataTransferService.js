import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/client.js';

export const SETTINGS_BACKUP_VERSION = 1;
export const REPLACE_ALL_DATASET_ORDER = ['holdings', 'cash', 'transactions', 'netWorthHistory', 'scenarioPlanning'];

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value) {
  return String(value ?? '').trim();
}

function asOptionalString(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function asFiniteNumber(value, fieldName, { min = Number.NEGATIVE_INFINITY } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${fieldName} must be a valid number${min > Number.NEGATIVE_INFINITY ? ` >= ${min}` : ''}.`);
  }
  return n;
}

function assertIsoDate(date, fieldName) {
  const value = asString(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${fieldName} must be YYYY-MM-DD.`);
  return value;
}

function assertIsoDateTime(value, fieldName) {
  const text = asString(value);
  const ts = Date.parse(text);
  if (!text || !Number.isFinite(ts)) throw new Error(`${fieldName} must be a valid ISO datetime string.`);
  return new Date(ts).toISOString();
}

function getArrayField(payload, fieldName) {
  const list = payload?.[fieldName];
  if (!Array.isArray(list)) throw new Error(`${fieldName} must be an array.`);
  return list;
}

function normalizeCashRows(list) {
  return list.map((row, idx) => {
    if (!isObject(row)) throw new Error(`cash[${idx}] must be an object.`);
    const id = asOptionalString(row.id);
    const currency = asString(row.currency).toUpperCase();
    const name = asString(row.name);
    const balance = asFiniteNumber(row.balance, `cash[${idx}].balance`);
    if (!currency) throw new Error(`cash[${idx}].currency is required.`);
    if (!name) throw new Error(`cash[${idx}].name is required.`);
    return { id, currency, name, balance };
  });
}

function normalizeNetWorthRows(list) {
  return list.map((row, idx) => {
    if (!isObject(row)) throw new Error(`netWorthHistory[${idx}] must be an object.`);
    const date = assertIsoDate(row.date, `netWorthHistory[${idx}].date`);
    const recordedAtUtc = assertIsoDateTime(row.recordedAtUtc, `netWorthHistory[${idx}].recordedAtUtc`);
    const netWorthCny = asFiniteNumber(row.netWorthCny ?? row.netWorth, `netWorthHistory[${idx}].netWorthCny`);
    const netWorthUsd =
      row.netWorthUsd == null || row.netWorthUsd === ''
        ? null
        : asFiniteNumber(row.netWorthUsd, `netWorthHistory[${idx}].netWorthUsd`);
    return { date, recordedAtUtc, netWorthCny, netWorthUsd };
  });
}

function normalizeHoldingRows(list) {
  return list.map((row, idx) => {
    if (!isObject(row)) throw new Error(`holdings[${idx}] must be an object.`);
    const symbol = asString(row.symbol).toUpperCase();
    const category = asString(row.category);
    const currency = asString(row.currency || 'USD').toUpperCase();
    const qty = asFiniteNumber(row.qty, `holdings[${idx}].qty`, { min: 0 });
    const purchasePrice = asFiniteNumber(row.purchasePrice, `holdings[${idx}].purchasePrice`, { min: 0 });
    const marketProvider = asOptionalString(row.marketProvider);
    const marketInstrumentId = asOptionalString(row.marketInstrumentId);
    if (!symbol) throw new Error(`holdings[${idx}].symbol is required.`);
    if (!category) throw new Error(`holdings[${idx}].category is required.`);
    return { symbol, category, currency, qty, purchasePrice, marketProvider, marketInstrumentId };
  });
}

function normalizeTransactionRows(list) {
  return list.map((row, idx) => {
    if (!isObject(row)) throw new Error(`transactions[${idx}] must be an object.`);
    const symbol = asString(row.symbol).toUpperCase();
    const type = asString(row.type).toUpperCase();
    const affectsHoldings =
      row.affectsHoldings == null ? true : row.affectsHoldings === true || row.affectsHoldings === 'true';
    const txDate = assertIsoDate(row.txDate, `transactions[${idx}].txDate`);
    const qty = asFiniteNumber(row.qty, `transactions[${idx}].qty`, { min: 0 });
    const avgCostPerUnit = asFiniteNumber(row.avgCostPerUnit, `transactions[${idx}].avgCostPerUnit`, { min: 0 });
    const feeFlat =
      row.feeFlat == null || row.feeFlat === ''
        ? null
        : asFiniteNumber(row.feeFlat, `transactions[${idx}].feeFlat`, { min: 0 });
    const costBasisPerUnit =
      row.costBasisPerUnit == null || row.costBasisPerUnit === ''
        ? null
        : asFiniteNumber(row.costBasisPerUnit, `transactions[${idx}].costBasisPerUnit`, { min: 0 });
    const notes = asOptionalString(row.notes);
    const deductCashId = asOptionalString(row.deductCashId);
    const creditCashId = asOptionalString(row.creditCashId);
    if (!symbol) throw new Error(`transactions[${idx}].symbol is required.`);
    if (type !== 'BUY' && type !== 'SELL') throw new Error(`transactions[${idx}].type must be BUY or SELL.`);
    if (qty <= 0) throw new Error(`transactions[${idx}].qty must be > 0.`);
    if (deductCashId && creditCashId) throw new Error(`transactions[${idx}] cannot set both deductCashId and creditCashId.`);
    return { symbol, type, affectsHoldings, txDate, qty, avgCostPerUnit, feeFlat, costBasisPerUnit, notes, deductCashId, creditCashId };
  });
}

function normalizeScenarioRows(list) {
  return list.map((row, idx) => {
    if (!isObject(row)) throw new Error(`scenarioPlanning.scenarios[${idx}] must be an object.`);
    const id = asOptionalString(row.id);
    const name = asString(row.name);
    if (!name) throw new Error(`scenarioPlanning.scenarios[${idx}].name is required.`);
    if (name.length > 120) throw new Error(`scenarioPlanning.scenarios[${idx}].name must be 120 chars or fewer.`);
    const isActive = Boolean(row.isActive);
    const targetPrices = (Array.isArray(row.targetPrices) ? row.targetPrices : []).map((item, itemIdx) => {
      if (!isObject(item)) throw new Error(`scenarioPlanning.scenarios[${idx}].targetPrices[${itemIdx}] must be an object.`);
      const symbol = asString(item.symbol).toUpperCase();
      const targetPrice = asFiniteNumber(
        item.targetPrice,
        `scenarioPlanning.scenarios[${idx}].targetPrices[${itemIdx}].targetPrice`,
        { min: 0 },
      );
      const targetPrice2 =
        item.targetPrice2 == null || item.targetPrice2 === ''
          ? 0
          : asFiniteNumber(
              item.targetPrice2,
              `scenarioPlanning.scenarios[${idx}].targetPrices[${itemIdx}].targetPrice2`,
              { min: 0 },
            );
      const currency = asOptionalString(item.currency)?.toUpperCase() ?? null;
      if (!symbol) throw new Error(`scenarioPlanning.scenarios[${idx}].targetPrices[${itemIdx}].symbol is required.`);
      return { symbol, targetPrice, targetPrice2, currency };
    });
    const hypotheticalPurchases = (Array.isArray(row.hypotheticalPurchases) ? row.hypotheticalPurchases : []).map(
      (item, itemIdx) => {
        if (!isObject(item)) {
          throw new Error(`scenarioPlanning.scenarios[${idx}].hypotheticalPurchases[${itemIdx}] must be an object.`);
        }
        const symbol = asString(item.symbol).toUpperCase();
        const qty = asFiniteNumber(
          item.qty,
          `scenarioPlanning.scenarios[${idx}].hypotheticalPurchases[${itemIdx}].qty`,
          { min: 0 },
        );
        const buyPrice = asFiniteNumber(
          item.buyPrice,
          `scenarioPlanning.scenarios[${idx}].hypotheticalPurchases[${itemIdx}].buyPrice`,
          { min: 0 },
        );
        const currency = asOptionalString(item.currency)?.toUpperCase() ?? null;
        const comment = asOptionalString(item.comment);
        if (!symbol) {
          throw new Error(`scenarioPlanning.scenarios[${idx}].hypotheticalPurchases[${itemIdx}].symbol is required.`);
        }
        if (qty <= 0) {
          throw new Error(`scenarioPlanning.scenarios[${idx}].hypotheticalPurchases[${itemIdx}].qty must be > 0.`);
        }
        return { symbol, qty, buyPrice, currency, comment };
      },
    );
    const hypotheticalSales = (Array.isArray(row.hypotheticalSales) ? row.hypotheticalSales : []).map((item, itemIdx) => {
      if (!isObject(item)) throw new Error(`scenarioPlanning.scenarios[${idx}].hypotheticalSales[${itemIdx}] must be an object.`);
      const symbol = asString(item.symbol).toUpperCase();
      const qty = asFiniteNumber(item.qty, `scenarioPlanning.scenarios[${idx}].hypotheticalSales[${itemIdx}].qty`, { min: 0 });
      const sellPrice = asFiniteNumber(
        item.sellPrice,
        `scenarioPlanning.scenarios[${idx}].hypotheticalSales[${itemIdx}].sellPrice`,
        { min: 0 },
      );
      const feeFlat =
        item.feeFlat == null || item.feeFlat === ''
          ? null
          : asFiniteNumber(item.feeFlat, `scenarioPlanning.scenarios[${idx}].hypotheticalSales[${itemIdx}].feeFlat`, { min: 0 });
      const currency = asOptionalString(item.currency)?.toUpperCase() ?? null;
      const comment = asOptionalString(item.comment);
      if (!symbol) throw new Error(`scenarioPlanning.scenarios[${idx}].hypotheticalSales[${itemIdx}].symbol is required.`);
      if (qty <= 0) throw new Error(`scenarioPlanning.scenarios[${idx}].hypotheticalSales[${itemIdx}].qty must be > 0.`);
      return { symbol, qty, sellPrice, feeFlat, currency, comment };
    });
    return { id, name, isActive, targetPrices, hypotheticalPurchases, hypotheticalSales };
  });
}

export async function listScenarioPlanningExportRows(userId) {
  const uid = asString(userId);
  if (!uid) throw new Error('Missing user id.');
  const [scenarioRes, targetRes, purchaseRes, saleRes] = await Promise.all([
    query(
      `SELECT id, name, is_active AS "isActive",
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAtUtc",
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAtUtc"
       FROM whatif_scenarios
       WHERE user_id = $1
       ORDER BY is_active DESC, updated_at DESC, created_at DESC`,
      [uid],
    ),
    query(
      `SELECT scenario_id AS "scenarioId", symbol,
              target_price::float8 AS "targetPrice",
              COALESCE(target_price_2, 0)::float8 AS "targetPrice2",
              COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency
       FROM whatif_target_prices
       WHERE scenario_id IN (SELECT id FROM whatif_scenarios WHERE user_id = $1)
       ORDER BY scenario_id ASC, symbol ASC`,
      [uid],
    ),
    query(
      `SELECT scenario_id AS "scenarioId", symbol,
              qty::float8 AS qty,
              buy_price::float8 AS "buyPrice",
              COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency,
              NULLIF(TRIM(comment_text), '') AS comment
       FROM whatif_hypothetical_purchases
       WHERE scenario_id IN (SELECT id FROM whatif_scenarios WHERE user_id = $1)
       ORDER BY scenario_id ASC, created_at ASC`,
      [uid],
    ),
    query(
      `SELECT scenario_id AS "scenarioId", symbol,
              qty::float8 AS qty,
              sell_price::float8 AS "sellPrice",
              fee_flat::float8 AS "feeFlat",
              COALESCE(NULLIF(TRIM(currency), ''), NULL) AS currency,
              NULLIF(TRIM(comment_text), '') AS comment
       FROM whatif_hypothetical_sales
       WHERE scenario_id IN (SELECT id FROM whatif_scenarios WHERE user_id = $1)
       ORDER BY scenario_id ASC, created_at ASC`,
      [uid],
    ),
  ]);
  const map = new Map(
    scenarioRes.rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        isActive: Boolean(row.isActive),
        createdAtUtc: row.createdAtUtc,
        updatedAtUtc: row.updatedAtUtc,
        targetPrices: [],
        hypotheticalPurchases: [],
        hypotheticalSales: [],
      },
    ]),
  );
  for (const row of targetRes.rows) {
    const scenario = map.get(row.scenarioId);
    if (!scenario) continue;
    scenario.targetPrices.push({
      symbol: String(row.symbol || '').toUpperCase(),
      targetPrice: Number(row.targetPrice ?? 0),
      targetPrice2: Number(row.targetPrice2 ?? 0),
      currency: row.currency == null ? null : String(row.currency).toUpperCase(),
    });
  }
  for (const row of purchaseRes.rows) {
    const scenario = map.get(row.scenarioId);
    if (!scenario) continue;
    scenario.hypotheticalPurchases.push({
      symbol: String(row.symbol || '').toUpperCase(),
      qty: Number(row.qty ?? 0),
      buyPrice: Number(row.buyPrice ?? 0),
      currency: row.currency == null ? null : String(row.currency).toUpperCase(),
      comment: row.comment ?? null,
    });
  }
  for (const row of saleRes.rows) {
    const scenario = map.get(row.scenarioId);
    if (!scenario) continue;
    scenario.hypotheticalSales.push({
      symbol: String(row.symbol || '').toUpperCase(),
      qty: Number(row.qty ?? 0),
      sellPrice: Number(row.sellPrice ?? 0),
      feeFlat: row.feeFlat == null ? null : Number(row.feeFlat),
      currency: row.currency == null ? null : String(row.currency).toUpperCase(),
      comment: row.comment ?? null,
    });
  }
  return Array.from(map.values());
}

export function buildSettingsExportPayload({ cashRows, netWorthRows, holdingsRows, transactionRows, scenarios = [] }) {
  return {
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    cash: (cashRows || []).map((row) => ({
      id: row.id ?? null,
      currency: String(row.currency || '').toUpperCase(),
      name: String(row.name || ''),
      balance: Number(row.balance ?? 0),
    })),
    netWorthHistory: (netWorthRows || []).map((row) => ({
      date: String(row.date || ''),
      recordedAtUtc: String(row.recordedAtUtc || ''),
      netWorthCny: Number(row.netWorthCny ?? 0),
      netWorthUsd: row.netWorthUsd == null ? null : Number(row.netWorthUsd),
    })),
    holdings: (holdingsRows || []).map((row) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      category: String(row.category || ''),
      currency: String(row.currency || 'USD').toUpperCase(),
      qty: Number(row.qty ?? 0),
      purchasePrice: Number(row.purchasePrice ?? 0),
      marketProvider: row.marketProvider ?? null,
      marketInstrumentId: row.marketInstrumentId ?? null,
    })),
    transactions: (transactionRows || []).map((row) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      type: String(row.type || '').toUpperCase(),
      affectsHoldings: Boolean(row.affectsHoldings),
      txDate: String(row.txDate || ''),
      qty: Number(row.qty ?? 0),
      avgCostPerUnit: Number(row.avgCostPerUnit ?? 0),
      feeFlat: row.feeFlat == null ? null : Number(row.feeFlat),
      costBasisPerUnit: row.costBasisPerUnit == null ? null : Number(row.costBasisPerUnit),
      notes: row.notes ?? null,
      deductCashId: row.deductCashId ?? null,
      creditCashId: row.creditCashId ?? null,
      createdAtUtc: row.createdAtUtc ?? null,
    })),
    scenarioPlanning: {
      scenarios,
    },
  };
}

export function normalizeSettingsImportPayload(input) {
  const payload = isObject(input?.backup) ? input.backup : input;
  if (!isObject(payload)) throw new Error('Import payload must be an object.');
  const version = Number(payload.version);
  if (!Number.isFinite(version) || version !== SETTINGS_BACKUP_VERSION) {
    throw new Error(`Unsupported backup version. Expected ${SETTINGS_BACKUP_VERSION}.`);
  }
  const cash = normalizeCashRows(getArrayField(payload, 'cash'));
  const netWorthHistory = normalizeNetWorthRows(getArrayField(payload, 'netWorthHistory'));
  const holdings = normalizeHoldingRows(getArrayField(payload, 'holdings'));
  const transactions = normalizeTransactionRows(getArrayField(payload, 'transactions'));
  const scenarios = normalizeScenarioRows(payload?.scenarioPlanning?.scenarios || []);
  return { version, cash, netWorthHistory, holdings, transactions, scenarioPlanning: { scenarios } };
}

export async function importSettingsDataReplaceAll({ userId, backup }) {
  const uid = asString(userId);
  if (!uid) throw new Error('Missing user id.');
  const normalized = normalizeSettingsImportPayload(backup);

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM whatif_target_prices WHERE scenario_id IN (SELECT id FROM whatif_scenarios WHERE user_id = $1)`, [uid]);
    await client.query(`DELETE FROM whatif_hypothetical_purchases WHERE scenario_id IN (SELECT id FROM whatif_scenarios WHERE user_id = $1)`, [uid]);
    await client.query(`DELETE FROM whatif_hypothetical_sales WHERE scenario_id IN (SELECT id FROM whatif_scenarios WHERE user_id = $1)`, [uid]);
    await client.query(`DELETE FROM whatif_scenarios WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM portfolio_position_transactions WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM cash WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [uid]);

    if (normalized.holdings.length > 0) {
      await client.query(
        `INSERT INTO portfolio_positions (user_id, symbol, category, currency, qty, purchase_price, market_provider, market_instrument_id)
         SELECT $1, upper(x.symbol), x.category, upper(coalesce(x.currency, 'USD')), x.qty, x."purchasePrice", x."marketProvider", x."marketInstrumentId"
         FROM jsonb_to_recordset($2::jsonb) AS x(symbol text, category text, currency text, qty float8, "purchasePrice" float8, "marketProvider" text, "marketInstrumentId" text)`,
        [uid, JSON.stringify(normalized.holdings)],
      );
    }

    const cashIdMap = new Map();
    const cashInsertRows = normalized.cash.map((row) => {
      const newId = randomUUID();
      if (row.id) cashIdMap.set(row.id, newId);
      return { id: newId, currency: row.currency, name: row.name, balance: row.balance };
    });
    if (cashInsertRows.length > 0) {
      await client.query(
        `INSERT INTO cash (id, user_id, currency, name, balance)
         SELECT (x.id)::uuid, $1, upper(x.currency), x.name, x.balance
         FROM jsonb_to_recordset($2::jsonb) AS x(id text, currency text, name text, balance float8)`,
        [uid, JSON.stringify(cashInsertRows)],
      );
    }

    const mappedTransactions = normalized.transactions.map((row, index) => {
      const mappedDeductCashId = row.deductCashId ? cashIdMap.get(row.deductCashId) : null;
      const mappedCreditCashId = row.creditCashId ? cashIdMap.get(row.creditCashId) : null;
      if (row.deductCashId && !mappedDeductCashId) {
        throw new Error(`transactions[${index}].deductCashId does not match any cash.id in this backup.`);
      }
      if (row.creditCashId && !mappedCreditCashId) {
        throw new Error(`transactions[${index}].creditCashId does not match any cash.id in this backup.`);
      }
      return {
        symbol: row.symbol,
        type: row.type,
        affectsHoldings: row.affectsHoldings,
        txDate: row.txDate,
        qty: row.qty,
        avgCostPerUnit: row.avgCostPerUnit,
        feeFlat: row.feeFlat,
        deductCashId: mappedDeductCashId,
        creditCashId: mappedCreditCashId,
        costBasisPerUnit: row.costBasisPerUnit,
        notes: row.notes,
      };
    });
    if (mappedTransactions.length > 0) {
      await client.query(
        `INSERT INTO portfolio_position_transactions (
          user_id, symbol, type, affects_holdings, tx_date, qty, avg_cost_per_unit, fee_flat_total, deduct_cash_id, credit_cash_id, cost_basis_per_unit, notes
        )
         SELECT $1, upper(x.symbol), upper(x.type), coalesce(x."affectsHoldings", TRUE), (x."txDate")::date, x.qty, x."avgCostPerUnit", x."feeFlat",
                (x."deductCashId")::uuid, (x."creditCashId")::uuid, x."costBasisPerUnit", x.notes
         FROM jsonb_to_recordset($2::jsonb) AS x(
           symbol text, type text, "affectsHoldings" boolean, "txDate" text, qty float8, "avgCostPerUnit" float8, "feeFlat" float8, "deductCashId" text, "creditCashId" text, "costBasisPerUnit" float8, notes text
         )`,
        [uid, JSON.stringify(mappedTransactions)],
      );
    }

    if (normalized.netWorthHistory.length > 0) {
      await client.query(
        `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, total_usd, quality_status, computed_at)
         SELECT $1, (x.date)::date, x."recordedAtUtc"::timestamptz, 'imported', x."netWorthCny", x."netWorthUsd", 'full', NOW()
         FROM jsonb_to_recordset($2::jsonb) AS x(date text, "recordedAtUtc" text, "netWorthCny" float8, "netWorthUsd" float8)`,
        [uid, JSON.stringify(normalized.netWorthHistory)],
      );
    }

    const scenarioIdMap = new Map();
    const scenarioInsertRows = normalized.scenarioPlanning.scenarios.map((scenario) => {
      const oldId = scenario.id || randomUUID();
      const newId = randomUUID();
      scenarioIdMap.set(oldId, newId);
      return { id: newId, name: scenario.name, isActive: scenario.isActive };
    });
    if (scenarioInsertRows.length > 0) {
      await client.query(
        `INSERT INTO whatif_scenarios (id, user_id, name, is_active)
         SELECT (x.id)::uuid, $1, x.name, x."isActive"
         FROM jsonb_to_recordset($2::jsonb) AS x(id text, name text, "isActive" boolean)`,
        [uid, JSON.stringify(scenarioInsertRows)],
      );
    }

    const targetRows = [];
    const purchaseRows = [];
    const saleRows = [];
    normalized.scenarioPlanning.scenarios.forEach((scenario, idx) => {
      const oldId = scenario.id || Array.from(scenarioIdMap.keys())[idx];
      const scenarioId = scenarioIdMap.get(oldId);
      if (!scenarioId) return;
      scenario.targetPrices.forEach((row) => targetRows.push({ scenarioId, ...row }));
      scenario.hypotheticalPurchases.forEach((row) => purchaseRows.push({ scenarioId, ...row }));
      scenario.hypotheticalSales.forEach((row) => saleRows.push({ scenarioId, ...row }));
    });

    if (targetRows.length > 0) {
      await client.query(
        `INSERT INTO whatif_target_prices (scenario_id, symbol, target_price, target_price_2, currency)
         SELECT (x."scenarioId")::uuid, upper(x.symbol), x."targetPrice", x."targetPrice2", x.currency
         FROM jsonb_to_recordset($1::jsonb) AS x("scenarioId" text, symbol text, "targetPrice" float8, "targetPrice2" float8, currency text)`,
        [JSON.stringify(targetRows)],
      );
    }
    if (purchaseRows.length > 0) {
      await client.query(
        `INSERT INTO whatif_hypothetical_purchases (scenario_id, symbol, qty, buy_price, currency, comment_text)
         SELECT (x."scenarioId")::uuid, upper(x.symbol), x.qty, x."buyPrice", x.currency, x.comment
         FROM jsonb_to_recordset($1::jsonb) AS x("scenarioId" text, symbol text, qty float8, "buyPrice" float8, currency text, comment text)`,
        [JSON.stringify(purchaseRows)],
      );
    }
    if (saleRows.length > 0) {
      await client.query(
        `INSERT INTO whatif_hypothetical_sales (scenario_id, symbol, qty, sell_price, fee_flat, currency, comment_text)
         SELECT (x."scenarioId")::uuid, upper(x.symbol), x.qty, x."sellPrice", x."feeFlat", x.currency, x.comment
         FROM jsonb_to_recordset($1::jsonb) AS x("scenarioId" text, symbol text, qty float8, "sellPrice" float8, "feeFlat" float8, currency text, comment text)`,
        [JSON.stringify(saleRows)],
      );
    }
  });

  return {
    ok: true,
    mode: 'replace-all',
    imported: {
      cash: normalized.cash.length,
      netWorthHistory: normalized.netWorthHistory.length,
      holdings: normalized.holdings.length,
      transactions: normalized.transactions.length,
      scenarios: normalized.scenarioPlanning.scenarios.length,
    },
  };
}
