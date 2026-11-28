import { ApiError } from '../lib/ApiError.js';
import { decryptSecret, encryptSecret } from '../lib/secretBox.js';
import {
  ExchangeError,
  assertReadOnlyBinanceKey,
  createBinanceClient,
} from '../lib/binanceClient.js';
import {
  SUPPORTED_QUOTES,
  groupBinanceSpotFills,
  isStableAsset,
  matchRecordedTrades,
  normalizeBinanceAsset,
  normalizeBinanceAutoInvest,
  normalizeBinanceConvert,
  suggestTradeInput,
} from '../lib/exchangeTrades.js';
import { parseRecurringBuyInput } from '../lib/recurringBuy.js';
import * as exchangeRepo from '../repositories/exchangeRepository.js';
import * as financeRepo from '../repositories/financeRepository.js';
import { createTradeService, parseTradeRequest } from './tradeService.js';

/**
 * Exchange sync: connect read-only exchange keys, fetch recent trades, flag the ones not yet
 * recorded in WorthTrack, and record (or ignore) them on the user's say-so.
 * Phase 1 supports Binance only.
 */

export const SUPPORTED_EXCHANGES = ['binance'];
const DAY_MS = 24 * 3600 * 1000;
const SYNC_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_PAIRS = 40;
const CONCURRENCY = 4;
const FILLS_LIMIT = 1000;

export function clampDays(value, fallback = 7) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(1, n));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Coins worth checking: held on Binance (spot or Earn) plus crypto held in WorthTrack. */
export function candidateBaseAssets(balances, positionSymbols) {
  const fromPositions = (positionSymbols || []).map((s) => String(s).toUpperCase());
  const fromBalances = (balances || [])
    .filter((b) => Number(b.free) + Number(b.locked) > 0)
    .map((b) => normalizeBinanceAsset(b.asset));
  const out = [];
  for (const asset of [...fromPositions, ...fromBalances]) {
    if (asset && !isStableAsset(asset) && /^[A-Z0-9]{2,15}$/.test(asset) && !out.includes(asset)) out.push(asset);
  }
  return out;
}

/**
 * Fetch and normalize Binance trades executed at or after sinceMs.
 * @returns {Promise<{ trades: object[], warnings: string[] }>}
 */
export async function fetchBinanceTrades(client, { sinceMs, nowMs, positionSymbols }) {
  const balances = await client.getBalances(); // also fails fast on a bad key / blocked location
  const bases = candidateBaseAssets(balances, positionSymbols);
  const pairs = bases.flatMap((base) => SUPPORTED_QUOTES.map((quote) => ({ base, quote, symbol: `${base}${quote}` })))
    .slice(0, MAX_PAIRS);
  const warnings = [];
  if (bases.length * SUPPORTED_QUOTES.length > MAX_PAIRS) {
    warnings.push(`Checked the first ${MAX_PAIRS / SUPPORTED_QUOTES.length} coins only.`);
  }

  const spot = await mapLimit(pairs, CONCURRENCY, async (pair) => {
    try {
      let fills = await client.getMyTrades(pair.symbol);
      if (!Array.isArray(fills)) return [];
      // Very active pair: the newest 1000 fills don't reach back to sinceMs, so walk 24h windows.
      if (fills.length >= FILLS_LIMIT && Math.min(...fills.map((f) => Number(f.time))) > sinceMs) {
        fills = [];
        for (let start = sinceMs; start < nowMs; start += DAY_MS) {
          const page = await client.getMyTrades(pair.symbol, { startTime: start, endTime: Math.min(start + DAY_MS - 1, nowMs) });
          if (Array.isArray(page)) fills.push(...page);
        }
      }
      return groupBinanceSpotFills(fills.filter((f) => Number(f.time) >= sinceMs), pair);
    } catch (error) {
      if (error?.code === 'invalid_symbol') return [];
      if (error?.code === 'invalid_key' || error?.code === 'restricted_location') throw error;
      warnings.push(`${pair.symbol}: ${error?.message || 'failed'}`);
      return [];
    }
  });

  const extra = [];
  try {
    extra.push(...(await client.getConvertTrades(sinceMs, nowMs)).map(normalizeBinanceConvert));
  } catch (error) {
    warnings.push(`Convert history: ${error?.message || 'failed'}`);
  }
  try {
    extra.push(...(await client.getAutoInvestHistory(sinceMs, nowMs)).map(normalizeBinanceAutoInvest));
  } catch (error) {
    warnings.push(`Auto-Invest history: ${error?.message || 'failed'}`);
  }

  const trades = [...spot.flat(), ...extra.filter(Boolean)].filter((t) => Date.parse(t.executedAt) >= sinceMs);
  return { trades, warnings };
}

/**
 * Raw Auto-Invest plan data (plan lists and per-plan holdings), kept with the connection so the
 * response shape can be checked before plan totals are relied on. Errors are recorded, not thrown.
 */
export async function probeAutoInvestPlans(client) {
  if (typeof client.getAutoInvestPlans !== 'function') return null;
  const out = { lists: {}, holdings: {} };
  const planIds = [];
  for (const planType of ['SINGLE', 'PORTFOLIO', 'INDEX']) {
    try {
      const body = await client.getAutoInvestPlans(planType);
      out.lists[planType] = body;
      for (const p of Array.isArray(body?.plans) ? body.plans : []) {
        if (p?.planId != null) planIds.push(p.planId);
      }
    } catch (error) {
      out.lists[planType] = { error: error?.message || 'failed', code: error?.code || null };
    }
  }
  for (const planId of planIds.slice(0, 10)) {
    try {
      out.holdings[planId] = await client.getAutoInvestPlanHoldings(planId);
    } catch (error) {
      out.holdings[planId] = { error: error?.message || 'failed', code: error?.code || null };
    }
  }
  return out;
}

function lastFour(value) {
  const s = String(value || '');
  return s.length <= 4 ? s : s.slice(-4);
}

function toApiError(error) {
  if (error instanceof ExchangeError) {
    return new ApiError(error.message, error.statusCode || 400, { code: error.code });
  }
  return error;
}

/**
 * Factory so tests can inject fakes.
 */
export function createExchangeSyncService({
  repo = exchangeRepo,
  finance = financeRepo,
  makeBinanceClient = createBinanceClient,
  trades: tradeService = createTradeService(),
  now = () => Date.now(),
  encrypt = encryptSecret,
  decrypt = decryptSecret,
} = {}) {
  function requireExchange(exchange) {
    const ex = String(exchange || '').trim().toLowerCase();
    if (!SUPPORTED_EXCHANGES.includes(ex)) {
      throw new ApiError('Only Binance is supported for now.', 400, { code: 'unsupported_exchange' });
    }
    return ex;
  }

  async function connect(userId, body = {}) {
    const exchange = requireExchange(body.exchange);
    const apiKey = String(body.apiKey || '').trim();
    const apiSecret = String(body.apiSecret || '').trim();
    if (!/^[A-Za-z0-9]{20,128}$/.test(apiKey) || !/^[A-Za-z0-9]{20,128}$/.test(apiSecret)) {
      throw new ApiError('Paste the API key and secret key exactly as Binance shows them.', 400, { code: 'invalid_input' });
    }
    try {
      const client = makeBinanceClient({ apiKey, apiSecret });
      assertReadOnlyBinanceKey(await client.getApiRestrictions());
    } catch (error) {
      throw toApiError(error);
    }
    return repo.upsertExchangeConnection({
      userId,
      exchange,
      apiKeyEnc: encrypt(apiKey),
      apiSecretEnc: encrypt(apiSecret),
      keyLast4: lastFour(apiKey),
    });
  }

  async function disconnect(userId, exchange) {
    const removed = await repo.deleteExchangeConnection(userId, requireExchange(exchange));
    if (!removed) throw new ApiError('No key saved for this exchange.', 404);
    return { ok: true };
  }

  /** Mark new trades that are already recorded in WorthTrack as matched. */
  async function autoMatch(userId, sinceMs) {
    const pending = await repo.listExchangeTrades(userId, { statuses: ['new'], since: new Date(sinceMs).toISOString() });
    if (pending.length === 0) return 0;
    const sinceDate = new Date(sinceMs - 2 * DAY_MS).toISOString().slice(0, 10);
    const transactions = await repo.listTransactionsForMatching(userId, sinceDate);
    const matches = matchRecordedTrades(pending, transactions);
    for (const [tradeId, txId] of matches) {
      await repo.setExchangeTradeStatus(userId, tradeId, 'matched', { matchedTransactionId: txId });
    }
    return matches.size;
  }

  /**
   * Fetch recent trades from every connected exchange. Skips an exchange checked in the last
   * 10 minutes unless force is set.
   */
  async function sync(userId, { days = 7, force = false } = {}) {
    const nowMs = now();
    const sinceMs = nowMs - clampDays(days) * DAY_MS;
    const connections = await repo.listExchangeConnectionsWithSecrets(userId);
    const results = [];
    for (const conn of connections) {
      const fresh = conn.lastSyncedAt && nowMs - Date.parse(conn.lastSyncedAt) < SYNC_COOLDOWN_MS && !conn.lastError;
      if (fresh && !force) {
        results.push({ exchange: conn.exchange, skipped: true });
        continue;
      }
      try {
        const client = makeBinanceClient({ apiKey: decrypt(conn.apiKeyEnc), apiSecret: decrypt(conn.apiSecretEnc) });
        const positions = await finance.listPortfolioPositions(userId);
        const cryptoSymbols = positions.filter((p) => /crypto/i.test(String(p.category || ''))).map((p) => p.symbol);
        const { trades, warnings } = await fetchBinanceTrades(client, { sinceMs, nowMs, positionSymbols: cryptoSymbols });
        const inserted = await repo.upsertExchangeTrades(userId, trades);
        const autoInvestPlans = await probeAutoInvestPlans(client);
        await repo.markExchangeConnectionSynced(userId, conn.exchange, { details: { warnings, autoInvestPlans } });
        results.push({ exchange: conn.exchange, fetched: trades.length, inserted, warnings });
      } catch (error) {
        const message = error instanceof ExchangeError ? error.message : 'Could not check this exchange.';
        await repo.markExchangeConnectionSynced(userId, conn.exchange, { error: message });
        results.push({ exchange: conn.exchange, error: message, code: error?.code || null });
      }
    }
    await repo.reopenOrphanedExchangeTrades(userId);
    await autoMatch(userId, sinceMs);
    return { results };
  }

  /** Trades in the window, split by status; new ones carry a suggested input and recurring plans. */
  async function listTrades(userId, { days = 7 } = {}) {
    const sinceMs = now() - clampDays(days) * DAY_MS;
    await repo.reopenOrphanedExchangeTrades(userId);
    const [connections, rows] = await Promise.all([
      repo.listExchangeConnections(userId),
      repo.listExchangeTrades(userId, { since: new Date(sinceMs).toISOString() }),
    ]);
    const counts = { new: 0, added: 0, ignored: 0, matched: 0 };
    rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

    const pending = rows.filter((r) => r.status === 'new');
    const publicClient = makeBinanceClient({ apiKey: '', apiSecret: '' });
    const priceCache = new Map();
    const plansCache = new Map();
    const enriched = [];
    for (const trade of pending) {
      let feeAssetPrice = null;
      const feeAsset = trade.feeAsset ? String(trade.feeAsset).toUpperCase() : null;
      if (feeAsset && feeAsset !== trade.baseAsset && feeAsset !== trade.quoteAsset && trade.fee > 0) {
        const pair = `${feeAsset}${trade.quoteAsset}`;
        if (!priceCache.has(pair)) priceCache.set(pair, await publicClient.getPrice(pair));
        feeAssetPrice = priceCache.get(pair);
      }
      let plans = [];
      if (trade.side === 'BUY') {
        if (!plansCache.has(trade.baseAsset)) plansCache.set(trade.baseAsset, await repo.listRecurringPlans(userId, trade.baseAsset));
        plans = plansCache.get(trade.baseAsset);
      }
      enriched.push({ ...trade, suggestion: suggestTradeInput(trade, { feeAssetPrice }), plans });
    }
    const others = rows.filter((r) => r.status !== 'new');
    return { days: clampDays(days), connections, counts, trades: enriched, resolved: others };
  }

  async function ignore(userId, id) {
    const ok = await repo.setExchangeTradeStatus(userId, id, 'ignored', { fromStatuses: ['new', 'matched'] });
    if (!ok) throw new ApiError('Trade not found or already handled.', 404);
    return { ok: true };
  }

  /** Put an ignored or matched trade back on the review list. */
  async function restore(userId, id) {
    const ok = await repo.setExchangeTradeStatus(userId, id, 'new', { fromStatuses: ['ignored', 'matched'] });
    if (!ok) throw new ApiError('Trade not found or not ignored.', 404);
    return { ok: true };
  }

  /**
   * Record a trade. body: { date, qty, pricePerUnit | totalAmount (+ feeInCrypto), fee,
   * cashAccountId, planId? }. With planId the buy is added to that recurring plan's totals.
   */
  async function add(userId, id, body = {}) {
    const trade = await repo.getExchangeTrade(userId, id);
    if (!trade) throw new ApiError('Trade not found.', 404);
    if (trade.status !== 'new') {
      throw new ApiError('This trade was already handled.', 409, { code: 'already_handled' });
    }
    if (!SUPPORTED_QUOTES.includes(String(trade.quoteAsset).toUpperCase())) {
      throw new ApiError('Only USDT and USDC pairs can be added automatically.', 400, { code: 'unsupported_quote' });
    }

    const request = {
      assetType: 'crypto',
      side: trade.side,
      symbol: trade.baseAsset,
      date: body.date,
      qty: body.qty,
      pricePerUnit: body.totalAmount != null && body.totalAmount !== '' ? undefined : body.pricePerUnit,
      totalAmount: body.totalAmount != null && body.totalAmount !== '' ? body.totalAmount : undefined,
      feeInCrypto: body.totalAmount != null && body.totalAmount !== '' ? body.feeInCrypto : undefined,
      fee: body.totalAmount != null && body.totalAmount !== '' ? undefined : body.fee,
      quoteCurrency: trade.quoteAsset,
      cashAccountId: body.cashAccountId || null,
      notes: `Order ${trade.orderRef}`,
    };
    const parsed = parseTradeRequest(request, { now: new Date(now()) });

    // Claim the trade first so a double click can't record it twice.
    const claimed = await repo.setExchangeTradeStatus(userId, id, 'added', { fromStatuses: ['new'] });
    if (!claimed) throw new ApiError('This trade was already handled.', 409, { code: 'already_handled' });

    try {
      if (body.planId) {
        if (trade.side !== 'BUY') throw new ApiError('Only buys can be added to a recurring plan.', 400);
        const plans = await repo.listRecurringPlans(userId, trade.baseAsset);
        const plan = plans.find((p) => p.id === body.planId);
        if (!plan) throw new ApiError('Recurring plan not found.', 404);
        const cost = parsed.qty * parsed.pricePerUnit + (parsed.fee || 0);
        const buy = parseRecurringBuyInput({
          name: plan.name,
          txDate: plan.txDate,
          totalQty: Number(plan.qty) + parsed.qty,
          totalInvested: Number(plan.invested) + cost,
          cashId: parsed.cashAccountId,
        });
        await finance.updateRecurringBuy({ userId, transactionId: plan.id, buy });
        await repo.linkExchangeTrade(userId, id, plan.id);
        return { ok: true, addedTo: 'plan', planName: plan.name };
      }
      const result = await tradeService.recordTrade(userId, request, { now: new Date(now()) });
      const txId = await repo.findTransactionIdByOrderNote(userId, trade.baseAsset, trade.orderRef);
      if (txId) await repo.linkExchangeTrade(userId, id, txId);
      return { ok: true, addedTo: 'transaction', ...result };
    } catch (error) {
      await repo.setExchangeTradeStatus(userId, id, 'new', { fromStatuses: ['added'] }).catch(() => {});
      throw error instanceof ApiError ? error : new ApiError(error?.message || 'Could not add the trade.', 400);
    }
  }

  return { connect, disconnect, sync, listTrades, ignore, restore, add, listConnections: (u) => repo.listExchangeConnections(u) };
}
