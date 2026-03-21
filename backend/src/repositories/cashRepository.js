import { query, withTransaction } from '../db/client.js';

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

/**
 * Atomically debit source and credit destination (amounts in each account's currency).
 * @param {string} userId
 * @param {string} fromCashId
 * @param {string} toCashId
 * @param {number} amountFrom
 * @param {number} amountTo
 */
export async function transferCashBetweenAccounts(userId, fromCashId, toCashId, amountFrom, amountTo) {
  const uid = String(userId);
  const fromId = String(fromCashId || '').trim();
  const toId = String(toCashId || '').trim();
  const debit = Number(amountFrom);
  const credit = Number(amountTo);
  if (!fromId || !toId || fromId === toId) {
    throw new Error('Invalid transfer accounts.');
  }
  if (!Number.isFinite(debit) || debit <= 0) {
    throw new Error('Debit amount must be positive.');
  }
  if (!Number.isFinite(credit)) {
    throw new Error('Invalid credit amount.');
  }

  await withTransaction(async (client) => {
    const fromRes = await client.query(
      `SELECT id, balance::float8 AS balance
       FROM cash
       WHERE user_id = $1 AND id = $2
       FOR UPDATE`,
      [uid, fromId],
    );
    const toRes = await client.query(
      `SELECT id
       FROM cash
       WHERE user_id = $1 AND id = $2
       FOR UPDATE`,
      [uid, toId],
    );
    if (fromRes.rowCount === 0) {
      throw new Error('Source cash account not found.');
    }
    if (toRes.rowCount === 0) {
      throw new Error('Destination cash account not found.');
    }
    const fromBal = Number(fromRes.rows[0].balance);
    if (!Number.isFinite(fromBal) || fromBal <= 0) {
      throw new Error('Source account must have a positive balance to transfer from.');
    }
    if (fromBal < debit) {
      throw new Error('Insufficient balance in the source account.');
    }

    await client.query(`UPDATE cash SET balance = balance - $1::float8 WHERE user_id = $2 AND id = $3`, [
      debit,
      uid,
      fromId,
    ]);
    await client.query(`UPDATE cash SET balance = balance + $1::float8 WHERE user_id = $2 AND id = $3`, [
      credit,
      uid,
      toId,
    ]);
  });
}

export async function replaceCashComponents(userId, components) {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM cash WHERE user_id = $1`, [userId]);
    for (const item of components) {
      const balance = Number(item.balance ?? item.amount ?? 0);
      if (!Number.isFinite(balance)) continue;
      await client.query(`INSERT INTO cash (user_id, currency, name, balance) VALUES ($1, $2, $3, $4)`, [
        userId,
        String(item.currency || '').toUpperCase(),
        String(item.name ?? item.displayName ?? '').trim() || 'Cash',
        balance,
      ]);
    }
  });
}
