import { query } from '../db/client.js';

// --- Connections -----------------------------------------------------------------------------

const CONNECTION_COLUMNS = `id, exchange, key_last4 AS "keyLast4", created_at AS "createdAt",
  last_synced_at AS "lastSyncedAt", last_error AS "lastError"`;

/** Public view of a user's connections (never includes the encrypted secrets). */
export async function listExchangeConnections(userId) {
  const result = await query(
    `SELECT ${CONNECTION_COLUMNS} FROM exchange_connections WHERE user_id = $1 ORDER BY exchange`,
    [userId],
  );
  return result.rows;
}

/** Connections including encrypted credentials, for the sync service only. */
export async function listExchangeConnectionsWithSecrets(userId) {
  const result = await query(
    `SELECT ${CONNECTION_COLUMNS}, api_key_enc AS "apiKeyEnc", api_secret_enc AS "apiSecretEnc"
     FROM exchange_connections WHERE user_id = $1 ORDER BY exchange`,
    [userId],
  );
  return result.rows;
}

/** Insert or replace the user's key for one exchange. */
export async function upsertExchangeConnection({ userId, exchange, apiKeyEnc, apiSecretEnc, keyLast4 }) {
  const result = await query(
    `INSERT INTO exchange_connections (user_id, exchange, api_key_enc, api_secret_enc, key_last4)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, exchange) DO UPDATE
       SET api_key_enc = EXCLUDED.api_key_enc,
           api_secret_enc = EXCLUDED.api_secret_enc,
           key_last4 = EXCLUDED.key_last4,
           created_at = NOW(),
           last_synced_at = NULL,
           last_error = NULL
     RETURNING ${CONNECTION_COLUMNS}`,
    [userId, exchange, apiKeyEnc, apiSecretEnc, keyLast4],
  );
  return result.rows[0];
}

/** Remove a key and the trades fetched with it. Returns true if a key was removed. */
export async function deleteExchangeConnection(userId, exchange) {
  const result = await query(
    `DELETE FROM exchange_connections WHERE user_id = $1 AND exchange = $2`,
    [userId, exchange],
  );
  await query(`DELETE FROM exchange_trades WHERE user_id = $1 AND exchange = $2`, [userId, exchange]);
  await query(`DELETE FROM exchange_plans WHERE user_id = $1 AND exchange = $2`, [userId, exchange]);
  return result.rowCount > 0;
}

export async function markExchangeConnectionSynced(userId, exchange, { error = null, details = null } = {}) {
  await query(
    `UPDATE exchange_connections
     SET last_synced_at = CASE WHEN $3::text IS NULL THEN NOW() ELSE last_synced_at END,
         last_error = $3,
         last_sync_details = COALESCE($4::jsonb, last_sync_details)
     WHERE user_id = $1 AND exchange = $2`,
    [userId, exchange, error, details ? JSON.stringify(details) : null],
  );
}

// --- Trades ----------------------------------------------------------------------------------

const TRADE_COLUMNS = `id, exchange, external_id AS "externalId", source, order_ref AS "orderRef",
  base_asset AS "baseAsset", quote_asset AS "quoteAsset", side, qty::float8 AS qty,
  quote_qty::float8 AS "quoteQty", fee::float8 AS fee, fee_asset AS "feeAsset",
  to_char(executed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "executedAt",
  status, matched_transaction_id AS "matchedTransactionId"`;

/**
 * Store fetched trades. Existing rows keep their status (a decision is never undone by a re-sync);
 * returns the number of rows that were new.
 */
export async function upsertExchangeTrades(userId, trades) {
  let inserted = 0;
  for (const t of trades) {
    const result = await query(
      `INSERT INTO exchange_trades
         (user_id, exchange, external_id, source, order_ref, base_asset, quote_asset, side, qty,
          quote_qty, fee, fee_asset, executed_at, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (user_id, exchange, external_id) DO NOTHING`,
      [
        userId,
        t.exchange,
        t.externalId,
        t.source,
        t.orderRef,
        t.baseAsset,
        t.quoteAsset,
        t.side,
        t.qty,
        t.quoteQty,
        t.fee || 0,
        t.feeAsset || null,
        t.executedAt,
        t.raw ? JSON.stringify(t.raw) : null,
      ],
    );
    inserted += result.rowCount;
  }
  return inserted;
}

export async function listExchangeTrades(userId, { since, statuses } = {}) {
  const result = await query(
    `SELECT ${TRADE_COLUMNS} FROM exchange_trades
     WHERE user_id = $1
       AND ($2::timestamptz IS NULL OR executed_at >= $2::timestamptz)
       AND ($3::text[] IS NULL OR status = ANY($3::text[]))
     ORDER BY executed_at DESC`,
    [userId, since || null, statuses || null],
  );
  return result.rows;
}

export async function getExchangeTrade(userId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const result = await query(`SELECT ${TRADE_COLUMNS} FROM exchange_trades WHERE user_id = $1 AND id = $2`, [userId, id]);
  return result.rows[0] || null;
}

/** Change status; only from `fromStatuses` so two clicks can't record a trade twice. */
export async function setExchangeTradeStatus(userId, id, status, { fromStatuses = ['new'], matchedTransactionId = null } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return false;
  // Back on the review list ('new') or ignored: no longer linked to a WorthTrack transaction.
  const result = await query(
    `UPDATE exchange_trades
     SET status = $3,
         matched_transaction_id = CASE WHEN $3 IN ('new', 'ignored') THEN NULL
                                       ELSE COALESCE($5::uuid, matched_transaction_id) END,
         updated_at = NOW()
     WHERE user_id = $1 AND id = $2 AND status = ANY($4::text[])`,
    [userId, id, status, fromStatuses, matchedTransactionId],
  );
  return result.rowCount > 0;
}

/** Link a trade to the WorthTrack transaction (or recurring plan row) that records it. */
export async function linkExchangeTrade(userId, id, transactionId) {
  await query(
    `UPDATE exchange_trades SET matched_transaction_id = $3, updated_at = NOW() WHERE user_id = $1 AND id = $2`,
    [userId, id, transactionId],
  );
}

/** Newest transaction for a symbol whose notes are exactly "Order <ref>" (written by exchange sync). */
export async function findTransactionIdByOrderNote(userId, symbol, orderRef) {
  const result = await query(
    `SELECT id FROM portfolio_position_transactions
     WHERE user_id = $1 AND upper(symbol) = upper($2) AND notes = $3
     ORDER BY created_at DESC LIMIT 1`,
    [userId, symbol, `Order ${orderRef}`],
  );
  return result.rows[0]?.id || null;
}

/**
 * Recorded / matched trades whose WorthTrack transaction was deleted go back on the review list.
 * Added trades are first relinked by their "Order <ref>" note (older rows may lack a link).
 * Returns how many trades were put back.
 */
export async function reopenOrphanedExchangeTrades(userId) {
  await query(
    `UPDATE exchange_trades e
     SET matched_transaction_id = p.id, updated_at = NOW()
     FROM portfolio_position_transactions p
     WHERE e.user_id = $1 AND e.status = 'added'
       AND NOT EXISTS (SELECT 1 FROM portfolio_position_transactions x WHERE x.id = e.matched_transaction_id)
       AND p.user_id = e.user_id AND upper(p.symbol) = e.base_asset AND p.notes = 'Order ' || e.order_ref`,
    [userId],
  );
  const result = await query(
    `UPDATE exchange_trades e
     SET status = 'new', matched_transaction_id = NULL, updated_at = NOW()
     WHERE e.user_id = $1 AND e.status IN ('added', 'matched')
       AND e.matched_transaction_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM portfolio_position_transactions p WHERE p.id = e.matched_transaction_id)`,
    [userId],
  );
  return result.rowCount;
}

// --- WorthTrack transactions used for matching -------------------------------------------------

/** BUY/SELL transactions (incl. imported history) on or after a date, for duplicate matching. */
export async function listTransactionsForMatching(userId, sinceDate) {
  const result = await query(
    `SELECT id, upper(symbol) AS symbol, upper(type) AS type, to_char(tx_date, 'YYYY-MM-DD') AS "txDate",
            qty::float8 AS qty, avg_cost_per_unit::float8 AS "avgCostPerUnit", notes, is_recurring AS "isRecurring"
     FROM portfolio_position_transactions
     WHERE user_id = $1 AND tx_date >= $2::date`,
    [userId, sinceDate],
  );
  return result.rows;
}

/** Recurring-buy plans for one symbol (running totals), for "add to plan". */
export async function listRecurringPlans(userId, symbol) {
  const result = await query(
    `SELECT id, notes AS name, to_char(tx_date, 'YYYY-MM-DD') AS "txDate", qty::float8 AS qty,
            round(qty * avg_cost_per_unit, 6)::float8 AS invested
     FROM portfolio_position_transactions
     WHERE user_id = $1 AND upper(symbol) = upper($2) AND is_recurring = TRUE AND type = 'BUY'
     ORDER BY created_at`,
    [userId, symbol],
  );
  return result.rows;
}

// --- Recurring plans (Auto-Invest) ------------------------------------------------------------

const PLAN_COLUMNS = `id, exchange, external_plan_id AS "externalPlanId", target_asset AS "targetAsset",
  source_asset AS "sourceAsset", name, plan_status AS "planStatus", total_qty::float8 AS "totalQty",
  total_invested::float8 AS "totalInvested",
  to_char(first_execution_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "firstExecutionAt",
  linked_transaction_id AS "linkedTransactionId", ignored`;

/** Store the latest plan totals; the link and ignore choice are kept. */
export async function upsertExchangePlans(userId, plans) {
  for (const p of plans) {
    await query(
      `INSERT INTO exchange_plans
         (user_id, exchange, external_plan_id, target_asset, source_asset, name, plan_status, total_qty,
          total_invested, first_execution_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, exchange, external_plan_id, target_asset) DO UPDATE
         SET source_asset = EXCLUDED.source_asset,
             name = EXCLUDED.name,
             plan_status = EXCLUDED.plan_status,
             total_qty = EXCLUDED.total_qty,
             total_invested = EXCLUDED.total_invested,
             first_execution_at = EXCLUDED.first_execution_at,
             updated_at = NOW()`,
      [userId, p.exchange, p.externalPlanId, p.targetAsset, p.sourceAsset, p.name, p.planStatus, p.totalQty,
        p.totalInvested, p.firstExecutionAt],
    );
  }
}

/** Plans with their linked WorthTrack recurring buy's current totals (null if unlinked or deleted). */
export async function listExchangePlans(userId) {
  const result = await query(
    `SELECT e.id, e.exchange, e.external_plan_id AS "externalPlanId", e.target_asset AS "targetAsset",
            e.source_asset AS "sourceAsset", e.name, e.plan_status AS "planStatus", e.total_qty::float8 AS "totalQty",
            e.total_invested::float8 AS "totalInvested",
            to_char(e.first_execution_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "firstExecutionDate",
            e.linked_transaction_id AS "linkedTransactionId", e.ignored,
            t.id AS "recurringId", t.notes AS "recurringName", to_char(t.tx_date, 'YYYY-MM-DD') AS "recurringTxDate",
            t.qty::float8 AS "recurringQty", round(t.qty * t.avg_cost_per_unit, 6)::float8 AS "recurringInvested"
     FROM exchange_plans e
     LEFT JOIN portfolio_position_transactions t
       ON t.id = e.linked_transaction_id AND t.user_id = e.user_id AND t.is_recurring = TRUE
     WHERE e.user_id = $1
     ORDER BY e.target_asset, e.name`,
    [userId],
  );
  return result.rows;
}

export async function getExchangePlan(userId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const result = await query(`SELECT ${PLAN_COLUMNS} FROM exchange_plans WHERE user_id = $1 AND id = $2`, [userId, id]);
  return result.rows[0] || null;
}

export async function setExchangePlanLink(userId, id, transactionId) {
  await query(
    `UPDATE exchange_plans SET linked_transaction_id = $3, ignored = FALSE, updated_at = NOW() WHERE user_id = $1 AND id = $2`,
    [userId, id, transactionId],
  );
}

export async function setExchangePlanIgnored(userId, id, ignored) {
  const result = await query(
    `UPDATE exchange_plans SET ignored = $3, updated_at = NOW() WHERE user_id = $1 AND id = $2`,
    [userId, id, Boolean(ignored)],
  );
  return result.rowCount > 0;
}

/** planId → plan name, from Auto-Invest history items already fetched (the plan list has no names). */
export async function listAutoInvestPlanNames(userId) {
  const result = await query(
    `SELECT DISTINCT ON (raw->>'planId') raw->>'planId' AS "planId", raw->>'planName' AS name
     FROM exchange_trades
     WHERE user_id = $1 AND source = 'auto_invest' AND raw ? 'planName'
     ORDER BY raw->>'planId', executed_at DESC`,
    [userId],
  );
  return new Map(result.rows.filter((r) => r.name).map((r) => [String(r.planId), r.name]));
}

/** One recurring-buy row by id (totals), or null. */
export async function getRecurringPlanById(userId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const result = await query(
    `SELECT id, upper(symbol) AS symbol, notes AS name, to_char(tx_date, 'YYYY-MM-DD') AS "txDate",
            qty::float8 AS qty, round(qty * avg_cost_per_unit, 6)::float8 AS invested
     FROM portfolio_position_transactions
     WHERE user_id = $1 AND id = $2 AND is_recurring = TRUE AND type = 'BUY'`,
    [userId, id],
  );
  return result.rows[0] || null;
}
