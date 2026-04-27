import { withTransaction } from '../db/client.js';

export const SETTINGS_BACKUP_VERSION = 1;
export const REPLACE_ALL_DATASET_ORDER = ['holdings', 'cash', 'transactions', 'netWorthHistory'];

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD.`);
  }
  return value;
}

function assertIsoDateTime(value, fieldName) {
  const text = asString(value);
  const ts = Date.parse(text);
  if (!text || !Number.isFinite(ts)) {
    throw new Error(`${fieldName} must be a valid ISO datetime string.`);
  }
  return new Date(ts).toISOString();
}

function getArrayField(payload, fieldName) {
  const list = payload?.[fieldName];
  if (!Array.isArray(list)) {
    throw new Error(`${fieldName} must be an array.`);
  }
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
    const netWorthCnyRaw = row.netWorthCny ?? row.netWorth;
    const netWorthCny = asFiniteNumber(netWorthCnyRaw, `netWorthHistory[${idx}].netWorthCny`);
    const hasUsd = row.netWorthUsd != null && row.netWorthUsd !== '';
    const netWorthUsd = hasUsd ? asFiniteNumber(row.netWorthUsd, `netWorthHistory[${idx}].netWorthUsd`) : null;
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
    if (!currency) throw new Error(`holdings[${idx}].currency is required.`);
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
    if (deductCashId && creditCashId) {
      throw new Error(`transactions[${idx}] cannot set both deductCashId and creditCashId.`);
    }
    return {
      symbol,
      type,
      affectsHoldings,
      txDate,
      qty,
      avgCostPerUnit,
      feeFlat,
      costBasisPerUnit,
      notes,
      deductCashId,
      creditCashId,
    };
  });
}

export function buildSettingsExportPayload({ cashRows, netWorthRows, holdingsRows, transactionRows }) {
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
  };
}

export function normalizeSettingsImportPayload(input) {
  const payload = isObject(input?.backup) ? input.backup : input;
  if (!isObject(payload)) {
    throw new Error('Import payload must be an object.');
  }
  const version = Number(payload.version);
  if (!Number.isFinite(version) || version !== SETTINGS_BACKUP_VERSION) {
    throw new Error(`Unsupported backup version. Expected ${SETTINGS_BACKUP_VERSION}.`);
  }

  const cash = normalizeCashRows(getArrayField(payload, 'cash'));
  const netWorthHistory = normalizeNetWorthRows(getArrayField(payload, 'netWorthHistory'));
  const holdings = normalizeHoldingRows(getArrayField(payload, 'holdings'));
  const transactions = normalizeTransactionRows(getArrayField(payload, 'transactions'));

  return { version, cash, netWorthHistory, holdings, transactions };
}

export async function importSettingsDataReplaceAll({ userId, backup }) {
  const uid = asString(userId);
  if (!uid) throw new Error('Missing user id.');

  const normalized = normalizeSettingsImportPayload(backup);
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM portfolio_position_transactions WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM cash WHERE user_id = $1`, [uid]);
    await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [uid]);

    for (const row of normalized.holdings) {
      await client.query(
        `INSERT INTO portfolio_positions (user_id, symbol, category, currency, qty, purchase_price, market_provider, market_instrument_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uid, row.symbol, row.category, row.currency, row.qty, row.purchasePrice, row.marketProvider, row.marketInstrumentId],
      );
    }

    const cashIdMap = new Map();
    for (const row of normalized.cash) {
      const inserted = await client.query(
        `INSERT INTO cash (user_id, currency, name, balance)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [uid, row.currency, row.name, row.balance],
      );
      const newCashId = inserted.rows?.[0]?.id ? String(inserted.rows[0].id) : null;
      if (row.id && newCashId) {
        cashIdMap.set(row.id, newCashId);
      }
    }

    for (const [index, row] of normalized.transactions.entries()) {
      const mappedDeductCashId = row.deductCashId ? cashIdMap.get(row.deductCashId) : null;
      const mappedCreditCashId = row.creditCashId ? cashIdMap.get(row.creditCashId) : null;
      if (row.deductCashId && !mappedDeductCashId) {
        throw new Error(`transactions[${index}].deductCashId does not match any cash.id in this backup.`);
      }
      if (row.creditCashId && !mappedCreditCashId) {
        throw new Error(`transactions[${index}].creditCashId does not match any cash.id in this backup.`);
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
          fee_flat_total,
          deduct_cash_id,
          credit_cash_id,
          cost_basis_per_unit,
          notes
        ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12)`,
        [
          uid,
          row.symbol,
          row.type,
          row.affectsHoldings,
          row.txDate,
          row.qty,
          row.avgCostPerUnit,
          row.feeFlat,
          mappedDeductCashId,
          mappedCreditCashId,
          row.costBasisPerUnit,
          row.notes,
        ],
      );
    }

    for (const row of normalized.netWorthHistory) {
      await client.query(
        `INSERT INTO networth_history (user_id, date_utc, recorded_at_utc, source, total_cny, total_usd, quality_status, computed_at)
         VALUES ($1, $2::date, $3, 'imported', $4, $5, 'full', NOW())`,
        [uid, row.date, row.recordedAtUtc, row.netWorthCny, row.netWorthUsd],
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
    },
  };
}
