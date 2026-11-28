/**
 * Pure helpers for exchange sync: turn raw exchange responses into one normalized trade per
 * order, suggest how to record each trade, and find trades already recorded in WorthTrack.
 *
 * Normalized trade:
 *   { exchange, externalId, source: 'spot'|'convert'|'auto_invest', orderRef, baseAsset, quoteAsset,
 *     side: 'BUY'|'SELL', qty (gross base), quoteQty, fee, feeAsset, executedAt (ISO), raw }
 */

export const SUPPORTED_QUOTES = ['USDT', 'USDC'];
const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'USDP', 'DAI', 'USD']);
const DAY_MS = 24 * 3600 * 1000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round8 = (n) => Math.round(n * 1e8) / 1e8;
const iso = (ms) => new Date(Number(ms)).toISOString();

export function isStableAsset(asset) {
  return STABLES.has(String(asset || '').toUpperCase());
}

/** Binance Simple Earn balances show as "LDBTC"; map them to the underlying coin. */
export function normalizeBinanceAsset(asset) {
  const a = String(asset || '').toUpperCase();
  return /^LD[A-Z0-9]{2,}$/.test(a) ? a.slice(2) : a;
}

/**
 * Group Binance /api/v3/myTrades fills into one trade per order.
 * @param {object[]} fills raw fills for one pair
 * @param {{ base: string, quote: string }} pair
 */
export function groupBinanceSpotFills(fills, { base, quote }) {
  const byOrder = new Map();
  for (const f of fills || []) {
    const key = String(f.orderId);
    let o = byOrder.get(key);
    if (!o) {
      o = { orderId: key, symbol: f.symbol, isBuyer: Boolean(f.isBuyer), qty: 0, quoteQty: 0, fees: new Map(), time: 0, fills: [] };
      byOrder.set(key, o);
    }
    o.qty += num(f.qty);
    o.quoteQty += num(f.quoteQty || num(f.qty) * num(f.price));
    const feeAsset = String(f.commissionAsset || '').toUpperCase();
    if (num(f.commission) > 0 && feeAsset) o.fees.set(feeAsset, (o.fees.get(feeAsset) || 0) + num(f.commission));
    o.time = Math.max(o.time, num(f.time));
    o.fills.push(f.id);
  }
  return [...byOrder.values()].map((o) => {
    // Several fee assets on one order is rare (e.g. BNB ran out mid-order); keep the largest-share one
    // by preferring base, then quote, then anything else.
    const feeAssets = [...o.fees.keys()];
    const feeAsset = feeAssets.find((a) => a === base) || feeAssets.find((a) => a === quote) || feeAssets[0] || null;
    return {
      exchange: 'binance',
      externalId: `spot:${o.symbol}:${o.orderId}`,
      source: 'spot',
      orderRef: o.orderId,
      baseAsset: base,
      quoteAsset: quote,
      side: o.isBuyer ? 'BUY' : 'SELL',
      qty: round8(o.qty),
      quoteQty: round8(o.quoteQty),
      fee: feeAsset ? round8(o.fees.get(feeAsset)) : 0,
      feeAsset,
      executedAt: iso(o.time),
      raw: { symbol: o.symbol, fillIds: o.fills, fees: Object.fromEntries(o.fees) },
    };
  });
}

/** Binance /sapi/v1/convert/tradeFlow item → trade (null for failed or stable↔stable converts). */
export function normalizeBinanceConvert(item) {
  if (!item || String(item.orderStatus || '').toUpperCase() !== 'SUCCESS') return null;
  const from = String(item.fromAsset || '').toUpperCase();
  const to = String(item.toAsset || '').toUpperCase();
  const fromAmount = num(item.fromAmount);
  const toAmount = num(item.toAmount);
  if (!from || !to || fromAmount <= 0 || toAmount <= 0) return null;
  if (isStableAsset(from) && isStableAsset(to)) return null;
  // Spending a stablecoin (or any other coin) on `to` is a BUY of `to`; receiving a stablecoin is a SELL.
  const isSell = isStableAsset(to) && !isStableAsset(from);
  return {
    exchange: 'binance',
    externalId: `convert:${item.orderId}`,
    source: 'convert',
    orderRef: String(item.orderId),
    baseAsset: isSell ? from : to,
    quoteAsset: isSell ? to : from,
    side: isSell ? 'SELL' : 'BUY',
    qty: isSell ? fromAmount : toAmount,
    quoteQty: isSell ? toAmount : fromAmount,
    fee: 0,
    feeAsset: null,
    executedAt: iso(item.createTime),
    raw: item,
  };
}

/** Binance /sapi/v1/lending/auto-invest/history/list item → BUY trade (null unless successful). */
export function normalizeBinanceAutoInvest(item) {
  if (!item || String(item.transactionStatus || '').toUpperCase() !== 'SUCCESS') return null;
  const target = String(item.targetAsset || '').toUpperCase();
  const source = String(item.sourceAsset || '').toUpperCase();
  const spent = num(item.sourceAssetAmount);
  const price = num(item.executionPrice);
  let qty = num(item.targetAssetAmount ?? item.targetAmount);
  if (qty <= 0 && price > 0) qty = (spent - num(item.transactionFee)) / price;
  if (!target || !source || spent <= 0 || qty <= 0) return null;
  const ref = String(item.id ?? item.transactionId);
  return {
    exchange: 'binance',
    externalId: `auto_invest:${ref}`,
    source: 'auto_invest',
    orderRef: ref,
    baseAsset: target,
    quoteAsset: source,
    side: 'BUY',
    qty: round8(qty),
    quoteQty: round8(spent), // total taken from the wallet, fee included
    fee: num(item.transactionFee),
    feeAsset: item.transactionFeeUnit ? String(item.transactionFeeUnit).toUpperCase() : null,
    executedAt: iso(item.transactionDateTime),
    raw: item,
  };
}

/**
 * Suggested input for recording a trade with the trade service (POST /api/v1/me/trades format).
 * @param {object} trade normalized trade
 * @param {{ feeAssetPrice?: number|null }} [opts] price of a third-asset fee (e.g. BNB) in the quote
 */
export function suggestTradeInput(trade, { feeAssetPrice = null } = {}) {
  const base = String(trade.baseAsset).toUpperCase();
  const quote = String(trade.quoteAsset).toUpperCase();
  const qty = num(trade.qty);
  const quoteQty = num(trade.quoteQty);
  const fee = num(trade.fee);
  const feeAsset = trade.feeAsset ? String(trade.feeAsset).toUpperCase() : null;
  const out = {
    supported: SUPPORTED_QUOTES.includes(quote) && qty > 0,
    unsupportedReason: null,
    side: trade.side,
    symbol: base,
    quoteCurrency: quote,
    mode: 'unit',
    qty,
    pricePerUnit: qty > 0 ? round8(quoteQty / qty) : 0,
    fee: null,
    totalAmount: null,
    feeInCrypto: null,
    feeEstimated: false,
    feeMissing: false,
  };
  if (!out.supported) {
    out.unsupportedReason = SUPPORTED_QUOTES.includes(quote) ? 'invalid_qty' : 'unsupported_quote';
    return out;
  }
  const avgPrice = quoteQty / qty;

  if (trade.side === 'BUY' && (trade.source === 'auto_invest' || trade.source === 'convert')) {
    // Amount spent already includes any fee.
    return { ...out, mode: 'total', totalAmount: round8(quoteQty), feeInCrypto: 0, pricePerUnit: round8(avgPrice) };
  }
  if (trade.side === 'BUY' && feeAsset === base && fee > 0) {
    // Fee taken from the coins received: record net coins at the full cost.
    return {
      ...out,
      mode: 'total',
      totalAmount: round8(quoteQty),
      feeInCrypto: round8(fee),
      pricePerUnit: round8(quoteQty / (qty - fee)),
    };
  }
  if (fee <= 0 || !feeAsset) return { ...out, fee: 0 };
  if (feeAsset === quote) return { ...out, fee: round8(fee) };
  if (feeAsset === base) return { ...out, fee: round8(fee * avgPrice) }; // SELL with fee in the sold coin
  if (Number.isFinite(feeAssetPrice) && feeAssetPrice > 0) {
    return { ...out, fee: round8(fee * feeAssetPrice), feeEstimated: true };
  }
  return { ...out, fee: 0, feeMissing: true };
}

/** UTC calendar day difference between an ISO timestamp and a YYYY-MM-DD date. */
function dayDistance(executedAtIso, txDate) {
  const a = Date.parse(`${String(executedAtIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${txDate}T00:00:00Z`);
  return Math.abs(a - b) / DAY_MS;
}

function qtyClose(a, b, tolerance = 0.005) {
  const x = num(a);
  const y = num(b);
  if (x <= 0 || y <= 0) return false;
  return Math.abs(x - y) / Math.max(x, y) <= tolerance;
}

/**
 * Find trades already recorded in WorthTrack.
 * 1. Order number in a transaction's notes ("Order 11680692515" — what the screenshot skill and
 *    exchange sync write).
 * 2. Otherwise same coin and side, date within a day, quantity within 0.5% (gross or net of a
 *    fee paid in the coin). Recurring-plan rows are totals, so they never match a single trade.
 * Each transaction matches at most one trade.
 * @returns {Map<string, string>} trade id → transaction id
 */
export function matchRecordedTrades(trades, transactions) {
  const matches = new Map();
  const used = new Set();
  const candidates = (transactions || []).filter((tx) => !tx.isRecurring);

  for (const trade of trades) {
    const ref = String(trade.orderRef || '');
    if (!ref) continue;
    const pattern = new RegExp(`(^|[^0-9A-Za-z])${ref.replace(/[^0-9A-Za-z]/g, '')}([^0-9A-Za-z]|$)`);
    const hit = candidates.find((tx) => !used.has(tx.id) && tx.notes && pattern.test(String(tx.notes)));
    if (hit) {
      matches.set(trade.id, hit.id);
      used.add(hit.id);
    }
  }

  for (const trade of trades) {
    if (matches.has(trade.id)) continue;
    const base = String(trade.baseAsset).toUpperCase();
    const netQty = String(trade.feeAsset || '').toUpperCase() === base ? num(trade.qty) - num(trade.fee) : num(trade.qty);
    const hit = candidates.find(
      (tx) => !used.has(tx.id)
        && String(tx.symbol).toUpperCase() === base
        && String(tx.type).toUpperCase() === trade.side
        && dayDistance(trade.executedAt, tx.txDate) <= 1
        && (qtyClose(tx.qty, trade.qty) || qtyClose(tx.qty, netQty)),
    );
    if (hit) {
      matches.set(trade.id, hit.id);
      used.add(hit.id);
    }
  }
  return matches;
}

/**
 * Binance Auto-Invest plan data (probeAutoInvestPlans output) → one entry per plan and coin with
 * the plan's running totals. Uses per-coin holdings when available (portfolio plans), else the
 * plan list's totals (single-coin plans).
 * @param {{ lists: object, holdings: object }} probe
 * @param {Map<string,string>|Record<string,string>} [names] planId → plan name (from history items)
 */
export function normalizeBinanceAutoInvestPlans(probe, names = {}) {
  const nameOf = (id) => (names instanceof Map ? names.get(String(id)) : names[String(id)]) || null;
  const out = [];
  for (const list of Object.values(probe?.lists || {})) {
    for (const plan of Array.isArray(list?.plans) ? list.plans : []) {
      const planId = String(plan.planId ?? '');
      if (!planId) continue;
      const holding = probe?.holdings?.[planId];
      const details = Array.isArray(holding?.details) && holding.details.length > 0
        ? holding.details.map((d) => ({ asset: d.targetAsset, qty: d.purchasedAmount, invested: d.totalInvestedInUSD }))
        : [{ asset: plan.targetAsset, qty: plan.totalTargetAmount, invested: plan.totalInvestedInUSD }];
      for (const d of details) {
        const asset = String(d.asset || '').toUpperCase();
        if (!asset) continue;
        out.push({
          exchange: 'binance',
          externalPlanId: planId,
          targetAsset: asset,
          sourceAsset: String(plan.sourceAsset || 'USDT').toUpperCase(),
          name: nameOf(planId) || `${asset} Auto-Invest #${planId}`,
          planStatus: plan.status ? String(plan.status).toUpperCase() : null,
          totalQty: round8(num(d.qty)),
          totalInvested: Math.round(num(d.invested) * 1e6) / 1e6,
          firstExecutionAt: num(plan.firstExecutionDateTime) > 0 ? iso(plan.firstExecutionDateTime) : null,
        });
      }
    }
  }
  return out;
}

/** True when a WorthTrack recurring buy's totals differ from the exchange plan's totals. */
export function planTotalsDiffer(plan, recurring) {
  if (!recurring) return true;
  return Math.abs(num(plan.totalQty) - num(recurring.qty)) > 1e-8
    || Math.abs(num(plan.totalInvested) - num(recurring.invested)) > 0.01;
}
