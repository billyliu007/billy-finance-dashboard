import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { assertReadOnlyBinanceKey, createBinanceClient, signQuery } from '../src/lib/binanceClient.js';
import {
  groupBinanceSpotFills,
  normalizeBinanceAutoInvestPlans,
  planTotalsDiffer,
  matchRecordedTrades,
  normalizeBinanceAsset,
  normalizeBinanceAutoInvest,
  normalizeBinanceConvert,
  suggestTradeInput,
} from '../src/lib/exchangeTrades.js';
import { decryptSecret, encryptSecret } from '../src/lib/secretBox.js';
import { candidateBaseAssets, createExchangeSyncService, fetchBinanceTrades } from '../src/services/exchangeSyncService.js';

const NOW = Date.parse('2026-11-28T08:00:00Z');
const USER = 'user-1';

// --- Binance client -------------------------------------------------------------------------

test('signQuery matches the HMAC example in Binance API docs', () => {
  const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
  const qs = 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
  assert.equal(signQuery(qs, secret), 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
});

test('client signs requests, sends the key header and maps errors', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v3/account')) return { ok: false, status: 451, json: async () => ({ code: 0, msg: 'Service unavailable from a restricted location' }) };
    if (url.includes('myTrades')) return { ok: false, status: 400, json: async () => ({ code: -2015, msg: 'Invalid API-key' }) };
    return { ok: true, status: 200, json: async () => ({ enableReading: true }) };
  };
  const client = createBinanceClient({ apiKey: 'KEY', apiSecret: 'SECRET', fetchImpl, now: () => 1700000000000 });
  await client.getApiRestrictions();
  const u = new URL(calls[0].url);
  assert.equal(calls[0].opts.headers['X-MBX-APIKEY'], 'KEY');
  assert.equal(u.searchParams.get('timestamp'), '1700000000000');
  const unsigned = u.search.slice(1).replace(/&signature=.*$/, '');
  assert.equal(u.searchParams.get('signature'), signQuery(unsigned, 'SECRET'));
  await assert.rejects(client.getBalances(), { code: 'restricted_location' });
  await assert.rejects(client.getMyTrades('BTCUSDT'), { code: 'invalid_key' });
});

test('only read-only keys are accepted', () => {
  assert.doesNotThrow(() => assertReadOnlyBinanceKey({ enableReading: true, enableWithdrawals: false }));
  assert.throws(() => assertReadOnlyBinanceKey({ enableReading: false }), { code: 'not_readable' });
  assert.throws(() => assertReadOnlyBinanceKey({ enableReading: true, enableSpotAndMarginTrading: true }), { code: 'key_not_read_only' });
});

test('secrets round-trip through AES-GCM and tampering is detected', () => {
  const key = randomBytes(32);
  const enc = encryptSecret('my-secret', key);
  assert.notEqual(enc, 'my-secret');
  assert.equal(decryptSecret(enc, key), 'my-secret');
  const parts = enc.split(':');
  parts[3] = Buffer.from('other').toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), key));
});

// --- Normalizing trades -----------------------------------------------------------------------

test('spot fills are grouped per order with summed qty, quote and fee', () => {
  const fills = [
    { symbol: 'BTCUSDC', id: 1, orderId: 77, price: '62000', qty: '0.02', quoteQty: '1240', commission: '0.00002', commissionAsset: 'BTC', time: NOW - 5000, isBuyer: true },
    { symbol: 'BTCUSDC', id: 2, orderId: 77, price: '62500', qty: '0.01194', quoteQty: '746.25', commission: '0.00001194', commissionAsset: 'BTC', time: NOW - 4000, isBuyer: true },
    { symbol: 'BTCUSDC', id: 3, orderId: 78, price: '63000', qty: '0.01', quoteQty: '630', commission: '0.63', commissionAsset: 'USDC', time: NOW - 1000, isBuyer: false },
  ];
  const [buy, sell] = groupBinanceSpotFills(fills, { base: 'BTC', quote: 'USDC' });
  assert.equal(buy.externalId, 'spot:BTCUSDC:77');
  assert.equal(buy.side, 'BUY');
  assert.equal(buy.qty, 0.03194);
  assert.equal(buy.quoteQty, 1986.25);
  assert.equal(buy.fee, 0.00003194);
  assert.equal(buy.feeAsset, 'BTC');
  assert.equal(buy.executedAt, new Date(NOW - 4000).toISOString());
  assert.equal(sell.side, 'SELL');
  assert.equal(sell.feeAsset, 'USDC');
});

test('convert and auto-invest items normalize to buys and sells', () => {
  const buy = normalizeBinanceConvert({ orderId: 9, orderStatus: 'SUCCESS', fromAsset: 'USDT', fromAmount: '100', toAsset: 'ADA', toAmount: '240', createTime: NOW });
  assert.deepEqual([buy.side, buy.baseAsset, buy.quoteAsset, buy.qty, buy.quoteQty], ['BUY', 'ADA', 'USDT', 240, 100]);
  const sell = normalizeBinanceConvert({ orderId: 10, orderStatus: 'SUCCESS', fromAsset: 'ETH', fromAmount: '0.5', toAsset: 'USDC', toAmount: '850', createTime: NOW });
  assert.deepEqual([sell.side, sell.baseAsset, sell.qty, sell.quoteQty], ['SELL', 'ETH', 0.5, 850]);
  assert.equal(normalizeBinanceConvert({ orderId: 11, orderStatus: 'SUCCESS', fromAsset: 'USDT', fromAmount: '1', toAsset: 'USDC', toAmount: '1', createTime: NOW }), null);
  assert.equal(normalizeBinanceConvert({ orderId: 12, orderStatus: 'FAIL', fromAsset: 'USDT', fromAmount: '1', toAsset: 'BTC', toAmount: '1', createTime: NOW }), null);

  const ai = normalizeBinanceAutoInvest({ id: 555, targetAsset: 'ADA', sourceAsset: 'USDT', sourceAssetAmount: '50', executionPrice: '0.4', transactionFee: '0', transactionStatus: 'SUCCESS', transactionDateTime: NOW });
  assert.deepEqual([ai.source, ai.side, ai.baseAsset, ai.qty, ai.quoteQty, ai.orderRef], ['auto_invest', 'BUY', 'ADA', 125, 50, '555']);
  assert.equal(normalizeBinanceAutoInvest({ id: 556, transactionStatus: 'FAILED' }), null);
});

test('Earn balances map to the underlying coin and stablecoins are skipped', () => {
  assert.equal(normalizeBinanceAsset('LDBTC'), 'BTC');
  assert.equal(normalizeBinanceAsset('LDO'), 'LDO');
  const bases = candidateBaseAssets(
    [{ asset: 'LDBTC', free: '0.1', locked: '0' }, { asset: 'USDT', free: '5', locked: '0' }, { asset: 'ADA', free: '0', locked: '0' }],
    ['ETH', 'btc'],
  );
  assert.deepEqual(bases, ['ETH', 'BTC']);
});

// --- Suggested input ------------------------------------------------------------------------

const baseTrade = { source: 'spot', baseAsset: 'BTC', quoteAsset: 'USDC', side: 'BUY', qty: 0.03194, quoteQty: 1999.444 };

test('buy with fee in the coin uses total-amount mode', () => {
  const s = suggestTradeInput({ ...baseTrade, fee: 0.00003194, feeAsset: 'BTC' });
  assert.equal(s.mode, 'total');
  assert.equal(s.totalAmount, 1999.444);
  assert.equal(s.feeInCrypto, 0.00003194);
  assert.ok(Math.abs(s.pricePerUnit - 62662.66) < 0.01);
});

test('fee in quote is passed through; BNB fee is estimated or flagged', () => {
  assert.equal(suggestTradeInput({ ...baseTrade, fee: 1.5, feeAsset: 'USDC' }).fee, 1.5);
  const est = suggestTradeInput({ ...baseTrade, fee: 0.002, feeAsset: 'BNB' }, { feeAssetPrice: 600 });
  assert.equal(est.fee, 1.2);
  assert.equal(est.feeEstimated, true);
  const missing = suggestTradeInput({ ...baseTrade, fee: 0.002, feeAsset: 'BNB' });
  assert.equal(missing.feeMissing, true);
});

test('pairs not quoted in USDT/USDC are not supported', () => {
  const s = suggestTradeInput({ ...baseTrade, baseAsset: 'ETH', quoteAsset: 'BTC', fee: 0 });
  assert.equal(s.supported, false);
  assert.equal(s.unsupportedReason, 'unsupported_quote');
});

// --- Matching ---------------------------------------------------------------------------------

test('trades match recorded transactions by order number, then by similarity', () => {
  const trades = [
    { id: 't1', orderRef: '11680692515', baseAsset: 'ETH', side: 'BUY', qty: 0.5, fee: 0.0005, feeAsset: 'ETH', executedAt: '2026-11-21T03:50:00Z' },
    { id: 't2', orderRef: '999', baseAsset: 'BTC', side: 'BUY', qty: 0.03194, fee: 0.00003194, feeAsset: 'BTC', executedAt: '2026-11-26T09:14:00Z' },
    { id: 't3', orderRef: '1000', baseAsset: 'ADA', side: 'BUY', qty: 1250, fee: 0, executedAt: '2026-11-25T08:00:00Z' },
  ];
  const txs = [
    { id: 'x1', symbol: 'ETH', type: 'BUY', txDate: '2026-11-21', qty: 0.499525, notes: 'Order 11680692515' },
    { id: 'x2', symbol: 'BTC', type: 'BUY', txDate: '2026-11-27', qty: 0.03190806, notes: null },
    { id: 'x3', symbol: 'ADA', type: 'BUY', txDate: '2026-11-01', qty: 1250, notes: 'ADA DCA', isRecurring: true },
  ];
  const m = matchRecordedTrades(trades, txs);
  assert.equal(m.get('t1'), 'x1');
  assert.equal(m.get('t2'), 'x2'); // net qty, next day
  assert.equal(m.has('t3'), false); // recurring totals never match
});

test('an order number inside a longer number does not match', () => {
  const m = matchRecordedTrades(
    [{ id: 't', orderRef: '1234', baseAsset: 'BTC', side: 'BUY', qty: 1, executedAt: '2026-11-01T00:00:00Z' }],
    [{ id: 'x', symbol: 'SOL', type: 'BUY', txDate: '2026-11-01', qty: 9, notes: 'Order 912345' }],
  );
  assert.equal(m.size, 0);
});

// --- Fetching -------------------------------------------------------------------------------

test('fetchBinanceTrades checks held coins against USDT and USDC and skips missing pairs', async () => {
  const asked = [];
  const client = {
    getBalances: async () => [{ asset: 'ADA', free: '10', locked: '0' }],
    getMyTrades: async (symbol) => {
      asked.push(symbol);
      if (symbol === 'ADAUSDC') { const e = new Error('Invalid symbol.'); e.code = 'invalid_symbol'; throw e; }
      if (symbol === 'ADAUSDT') {
        return [
          { symbol, id: 1, orderId: 5, qty: '100', quoteQty: '41', commission: '0.1', commissionAsset: 'ADA', time: NOW - 3600e3, isBuyer: true },
          { symbol, id: 0, orderId: 4, qty: '50', quoteQty: '20', commission: '0', commissionAsset: 'ADA', time: NOW - 30 * 86400e3, isBuyer: true },
        ];
      }
      return [];
    },
    getConvertTrades: async () => [],
    getAutoInvestHistory: async () => { throw new Error('no permission'); },
  };
  const { trades, warnings } = await fetchBinanceTrades(client, { sinceMs: NOW - 7 * 86400e3, nowMs: NOW, positionSymbols: [] });
  assert.deepEqual(asked.sort(), ['ADAUSDC', 'ADAUSDT']);
  assert.equal(trades.length, 1); // the 30-day-old order is outside the window
  assert.equal(trades[0].orderRef, '5');
  assert.equal(warnings.length, 1);
});

// --- Service --------------------------------------------------------------------------------

function fakeRepo(initialTrades = []) {
  const trades = initialTrades.map((t) => ({ ...t }));
  const conns = [];
  return {
    trades,
    conns,
    upsertExchangeConnection: async (c) => { conns.push(c); return { exchange: c.exchange, keyLast4: c.keyLast4 }; },
    listExchangeConnections: async () => conns,
    listExchangeConnectionsWithSecrets: async () => conns.map((c) => ({ ...c, lastSyncedAt: null, lastError: null })),
    deleteExchangeConnection: async () => true,
    markExchangeConnectionSynced: async () => {},
    upsertExchangeTrades: async (_u, list) => {
      let n = 0;
      for (const t of list) {
        if (!trades.some((x) => x.externalId === t.externalId)) {
          trades.push({ ...t, id: `id-${trades.length + 1}`, status: 'new' });
          n += 1;
        }
      }
      return n;
    },
    listExchangeTrades: async (_u, { statuses } = {}) => trades.filter((t) => !statuses || statuses.includes(t.status)),
    getExchangeTrade: async (_u, id) => trades.find((t) => t.id === id) || null,
    setExchangeTradeStatus: async (_u, id, status, { fromStatuses = ['new'] } = {}) => {
      const t = trades.find((x) => x.id === id);
      if (!t || !fromStatuses.includes(t.status)) return false;
      t.status = status;
      return true;
    },
    listTransactionsForMatching: async () => [{ id: 'x1', symbol: 'ETH', type: 'SELL', txDate: '2026-11-27', qty: 0.5, notes: null }],
    listRecurringPlans: async () => [{ id: 'plan-1', name: 'ADA DCA', txDate: '2026-10-01', qty: 1000, invested: 400 }],
    links: [],
    linkExchangeTrade: async (_u, id, txId) => {
      const t = trades.find((x) => x.id === id);
      if (t) t.matchedTransactionId = txId;
    },
    findTransactionIdByOrderNote: async () => 'tx-new',
    reopenOrphanedExchangeTrades: async () => 0,
  };
}

const identity = (s) => `enc:${s}`;
const unwrap = (s) => s.replace(/^enc:/, '');

test('connect refuses keys that can trade and stores read-only keys encrypted', async () => {
  const repo = fakeRepo();
  const makeClient = ({ apiKey }) => ({
    getApiRestrictions: async () => ({ enableReading: true, enableSpotAndMarginTrading: apiKey.startsWith('TRADE') }),
  });
  const svc = createExchangeSyncService({ repo, makeBinanceClient: makeClient, encrypt: identity, decrypt: unwrap, now: () => NOW });
  await assert.rejects(svc.connect(USER, { exchange: 'binance', apiKey: `TRADE${'a'.repeat(30)}`, apiSecret: 'b'.repeat(40) }), { code: 'key_not_read_only' });
  const key = `READ${'a'.repeat(30)}wxyz`;
  const conn = await svc.connect(USER, { exchange: 'binance', apiKey: key, apiSecret: 'b'.repeat(40) });
  assert.equal(conn.keyLast4, 'wxyz');
  assert.equal(repo.conns[0].apiKeyEnc, `enc:${key}`);
  await assert.rejects(svc.connect(USER, { exchange: 'kraken', apiKey: key, apiSecret: key }), { code: 'unsupported_exchange' });
});

test('sync stores new trades and auto-matches ones already recorded', async () => {
  const repo = fakeRepo();
  repo.conns.push({ exchange: 'binance', apiKeyEnc: 'enc:k', apiSecretEnc: 'enc:s' });
  const client = {
    getBalances: async () => [{ asset: 'ETH', free: '1', locked: '0' }],
    getMyTrades: async (symbol) => (symbol === 'ETHUSDC'
      ? [{ symbol, id: 1, orderId: 42, qty: '0.5', quoteQty: '850', commission: '0.85', commissionAsset: 'USDC', time: NOW - 86400e3, isBuyer: false }]
      : []),
    getConvertTrades: async () => [{ orderId: 7, orderStatus: 'SUCCESS', fromAsset: 'USDT', fromAmount: '50', toAsset: 'ADA', toAmount: '120', createTime: NOW - 3600e3 }],
    getAutoInvestHistory: async () => [],
  };
  const finance = { listPortfolioPositions: async () => [] };
  const svc = createExchangeSyncService({ repo, finance, makeBinanceClient: () => client, decrypt: unwrap, now: () => NOW });
  const { results } = await svc.sync(USER, { days: 7 });
  assert.equal(results[0].inserted, 2);
  const eth = repo.trades.find((t) => t.baseAsset === 'ETH');
  const ada = repo.trades.find((t) => t.baseAsset === 'ADA');
  assert.equal(eth.status, 'matched');
  assert.equal(ada.status, 'new');
  // A second sync never resets a decision.
  await svc.sync(USER, { days: 7, force: true });
  assert.equal(repo.trades.length, 2);
  assert.equal(repo.trades.find((t) => t.baseAsset === 'ETH').status, 'matched');
});

const pendingBuy = {
  id: 'id-1', status: 'new', exchange: 'binance', source: 'spot', orderRef: '11680692515', baseAsset: 'BTC', quoteAsset: 'USDC',
  side: 'BUY', qty: 0.03194, quoteQty: 1999.444, fee: 0.00003194, feeAsset: 'BTC', executedAt: '2026-11-26T09:14:00Z',
};

test('add records the trade with the order number and cash account, once', async () => {
  const repo = fakeRepo([pendingBuy]);
  const recorded = [];
  const trades = { recordTrade: async (_u, body) => { recorded.push(body); return { ok: true }; } };
  const svc = createExchangeSyncService({ repo, trades, now: () => NOW });
  await svc.add(USER, 'id-1', { date: '2026-11-26', qty: 0.03194, totalAmount: 1999.444, feeInCrypto: 0.00003194, cashAccountId: 'cash-1' });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].notes, 'Order 11680692515');
  assert.equal(recorded[0].cashAccountId, 'cash-1');
  assert.equal(recorded[0].quoteCurrency, 'USDC');
  assert.equal(repo.trades[0].status, 'added');
  assert.equal(repo.trades[0].matchedTransactionId, 'tx-new'); // linked, so deleting it reopens the trade
  await assert.rejects(svc.add(USER, 'id-1', { date: '2026-11-26', qty: 1, pricePerUnit: 1 }), { code: 'already_handled' });
});

test('a failed add puts the trade back on the list', async () => {
  const repo = fakeRepo([pendingBuy]);
  const trades = { recordTrade: async () => { throw new Error('Cash account not found.'); } };
  const svc = createExchangeSyncService({ repo, trades, now: () => NOW });
  await assert.rejects(svc.add(USER, 'id-1', { date: '2026-11-26', qty: 0.03194, pricePerUnit: 62000, fee: 0 }), /Cash account not found/);
  assert.equal(repo.trades[0].status, 'new');
});

test('add to a recurring plan increases the plan totals', async () => {
  const repo = fakeRepo([{ ...pendingBuy, id: 'id-2', baseAsset: 'ADA', quoteAsset: 'USDT', qty: 125, quoteQty: 50, fee: 0, feeAsset: null, source: 'auto_invest' }]);
  const updates = [];
  const finance = { updateRecurringBuy: async (args) => { updates.push(args); return { ok: true }; } };
  const svc = createExchangeSyncService({ repo, finance, now: () => NOW });
  const res = await svc.add(USER, 'id-2', { date: '2026-11-25', qty: 125, totalAmount: 50, feeInCrypto: 0, planId: 'plan-1', cashAccountId: 'cash-9' });
  assert.equal(res.addedTo, 'plan');
  assert.equal(updates[0].transactionId, 'plan-1');
  assert.equal(updates[0].buy.qty, 1125);
  assert.equal(updates[0].buy.totalInvested, 450);
  assert.equal(updates[0].buy.cashId, 'cash-9');
  assert.equal(updates[0].buy.name, 'ADA DCA');
  assert.equal(repo.trades[0].matchedTransactionId, 'plan-1');
});

test('ignore and restore move a trade between lists', async () => {
  const repo = fakeRepo([pendingBuy]);
  const svc = createExchangeSyncService({ repo, now: () => NOW });
  await svc.ignore(USER, 'id-1');
  assert.equal(repo.trades[0].status, 'ignored');
  await svc.restore(USER, 'id-1');
  assert.equal(repo.trades[0].status, 'new');
});

// --- Recurring plans --------------------------------------------------------------------------

const PROBE = {
  lists: {
    SINGLE: {
      plans: [
        { planId: 12485784, status: 'ONGOING', sourceAsset: 'USDT', targetAsset: 'BTC', totalTargetAmount: '0.09247879', totalInvestedInUSD: '6972.24028757', firstExecutionDateTime: 1789261995000 },
        { planId: 9986769, status: 'PAUSED', sourceAsset: 'USDT', targetAsset: 'BTC', totalTargetAmount: '0.02937226', totalInvestedInUSD: '2490.76828572', firstExecutionDateTime: 1731373200000 },
      ],
    },
    PORTFOLIO: {
      plans: [{ planId: 55, status: 'ONGOING', sourceAsset: 'USDC', totalTargetAmount: '0', totalInvestedInUSD: '300' }],
    },
    INDEX: { plans: [] },
  },
  holdings: {
    55: {
      details: [
        { targetAsset: 'BTC', purchasedAmount: '0.001', totalInvestedInUSD: '100' },
        { targetAsset: 'ETH', purchasedAmount: '0.1', totalInvestedInUSD: '200' },
      ],
    },
  },
};

test('Auto-Invest plans normalize to one entry per plan and coin, named from history', () => {
  const plans = normalizeBinanceAutoInvestPlans(PROBE, new Map([['12485784', 'BTC Recurring Plan 202609']]));
  assert.equal(plans.length, 4);
  const active = plans.find((p) => p.externalPlanId === '12485784');
  assert.deepEqual(
    [active.name, active.targetAsset, active.totalQty, active.totalInvested, active.planStatus, active.firstExecutionAt.slice(0, 10)],
    ['BTC Recurring Plan 202609', 'BTC', 0.09247879, 6972.240288, 'ONGOING', '2026-09-13'],
  );
  assert.equal(plans.find((p) => p.externalPlanId === '9986769').name, 'BTC Auto-Invest #9986769');
  const portfolio = plans.filter((p) => p.externalPlanId === '55');
  assert.deepEqual(portfolio.map((p) => [p.targetAsset, p.totalQty, p.totalInvested, p.sourceAsset]), [['BTC', 0.001, 100, 'USDC'], ['ETH', 0.1, 200, 'USDC']]);
});

test('USDT plan totals reported in USD are converted back to USDT', () => {
  const plans = normalizeBinanceAutoInvestPlans(PROBE, {}, { usdPerSource: { USDT: 1.00075056 } });
  const active = plans.find((p) => p.externalPlanId === '12485784');
  assert.ok(Math.abs(active.totalInvested - 6967.0111) < 0.001); // matches the Binance app's 6,967.01110735
  assert.ok(Math.abs(active.totalInvested / active.totalQty - 75336.31) < 0.01);
  assert.equal(plans.find((p) => p.externalPlanId === '55' && p.targetAsset === 'ETH').totalInvested, 200); // USDC plan unchanged
});

test('planTotalsDiffer ignores rounding noise', () => {
  assert.equal(planTotalsDiffer({ totalQty: 1, totalInvested: 100 }, null), true);
  assert.equal(planTotalsDiffer({ totalQty: 1, totalInvested: 100 }, { qty: 1, invested: 100.004 }), false);
  assert.equal(planTotalsDiffer({ totalQty: 1, totalInvested: 6967.01 }, { qty: 1, invested: 6967.5 }), false); // rate drift
  assert.equal(planTotalsDiffer({ totalQty: 1, totalInvested: 6967.01 }, { qty: 1, invested: 6972.24 }), true);
  assert.equal(planTotalsDiffer({ totalQty: 1.1, totalInvested: 100 }, { qty: 1, invested: 100 }), true);
});

function planRepo({ linked = null } = {}) {
  const plan = {
    id: 'p-1', exchange: 'binance', externalPlanId: '12485784', name: 'BTC Recurring Plan 202609', targetAsset: 'BTC', sourceAsset: 'USDT',
    totalQty: 0.09247879, totalInvested: 6972.240288, firstExecutionAt: '2026-09-13T01:13:15Z', linkedTransactionId: linked, ignored: false,
  };
  return {
    plan,
    getExchangePlan: async (_u, id) => (id === plan.id ? plan : null),
    getRecurringPlanById: async (_u, id) => (id === 'r-1' ? { id: 'r-1', symbol: 'BTC', name: 'BTC DCA', txDate: '2026-09-13', qty: 0.09, invested: 6800 } : null),
    setExchangePlanLink: async (_u, _id, txId) => { plan.linkedTransactionId = txId; },
    setExchangePlanIgnored: async (_u, _id, v) => { plan.ignored = v; return true; },
  };
}

test('apply to an existing recurring buy replaces its totals and links it', async () => {
  const repo = planRepo();
  const updates = [];
  const finance = { updateRecurringBuy: async (a) => { updates.push(a); } };
  const svc = createExchangeSyncService({ repo, finance, now: () => NOW });
  const res = await svc.applyPlan(USER, 'p-1', { recurringId: 'r-1', cashAccountId: 'cash-1' });
  assert.equal(res.created, false);
  assert.equal(updates[0].transactionId, 'r-1');
  assert.deepEqual([updates[0].buy.name, updates[0].buy.txDate, updates[0].buy.qty, updates[0].buy.totalInvested, updates[0].buy.cashId], ['BTC DCA', '2026-09-13', 0.09247879, 6972.240288, 'cash-1']);
  assert.equal(repo.plan.linkedTransactionId, 'r-1');
});

test('apply with create makes a new recurring buy (asset created if needed) and links it', async () => {
  const repo = planRepo();
  const created = [];
  const ensured = [];
  const finance = { createRecurringBuy: async (a) => { created.push(a); return { id: 'r-new' }; } };
  const trades = { ensureCryptoAsset: async (...a) => { ensured.push(a); return true; } };
  const svc = createExchangeSyncService({ repo, finance, trades, now: () => NOW });
  const res = await svc.applyPlan(USER, 'p-1', { create: true });
  assert.deepEqual(ensured[0], [USER, 'BTC', 'USDT']);
  assert.equal(created[0].symbol, 'BTC');
  assert.deepEqual([created[0].buy.name, created[0].buy.txDate, created[0].buy.cashId], ['BTC Recurring Plan 202609', '2026-09-13', null]);
  assert.equal(res.recurringId, 'r-new');
  assert.equal(repo.plan.linkedTransactionId, 'r-new');
});

test('a linked plan updates its own recurring buy without asking again', async () => {
  const repo = planRepo({ linked: 'r-1' });
  const updates = [];
  const svc = createExchangeSyncService({ repo, finance: { updateRecurringBuy: async (a) => updates.push(a) }, now: () => NOW });
  await svc.applyPlan(USER, 'p-1', {});
  assert.equal(updates[0].transactionId, 'r-1');
});
