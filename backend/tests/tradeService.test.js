import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradeService, parseTradeRequest } from '../src/services/tradeService.js';

const NOW = new Date('2026-11-19T08:00:00Z');
const USER = 'user-1';

// --- request parsing ------------------------------------------------------------------------

test('unit-price input: defaults date to today (UTC) and normalizes fields', () => {
  const t = parseTradeRequest(
    { assetType: 'Stock', side: 'buy', symbol: 'aapl', qty: '2', pricePerUnit: 190.5, fee: 1 },
    { now: NOW },
  );
  assert.deepEqual(
    { assetType: t.assetType, side: t.side, symbol: t.symbol, txDate: t.txDate, qty: t.qty, pricePerUnit: t.pricePerUnit, fee: t.fee, inputMode: t.inputMode },
    { assetType: 'stock', side: 'BUY', symbol: 'AAPL', txDate: '2026-11-19', qty: 2, pricePerUnit: 190.5, fee: 1, inputMode: 'unit' },
  );
});

test('crypto total-amount input: net qty = qty - feeInCrypto, price = total / net qty', () => {
  const t = parseTradeRequest(
    { assetType: 'crypto', side: 'buy', symbol: 'btc', qty: 0.0101, totalAmount: 1000, feeInCrypto: 0.0001, date: '2026-11-18' },
    { now: NOW },
  );
  assert.equal(t.inputMode, 'total');
  assert.ok(Math.abs(t.qty - 0.01) < 1e-12);
  assert.ok(Math.abs(t.pricePerUnit - 100000) < 1e-6);
  assert.equal(t.fee, null);
  assert.equal(t.grossQty, 0.0101);
  assert.equal(t.totalAmount, 1000);
  assert.equal(t.feeInCrypto, 0.0001);
});

test('request validation errors carry codes', () => {
  const cases = [
    [{ side: 'buy', symbol: 'X', qty: 1, pricePerUnit: 1 }, 'invalid_asset_type'],
    [{ assetType: 'stock', side: 'hold', symbol: 'X', qty: 1, pricePerUnit: 1 }, 'invalid_side'],
    [{ assetType: 'stock', side: 'buy', symbol: '', qty: 1, pricePerUnit: 1 }, 'invalid_symbol'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 0, pricePerUnit: 1 }, 'invalid_qty'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 1 }, 'invalid_price'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 1, pricePerUnit: 1, date: '2026-02-30' }, 'invalid_date'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 1, pricePerUnit: 1, date: '2027-01-01' }, 'invalid_date'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 1, totalAmount: 100 }, 'invalid_input_mode'],
    [{ assetType: 'crypto', side: 'sell', symbol: 'BTC', qty: 1, totalAmount: 100 }, 'invalid_input_mode'],
    [{ assetType: 'crypto', side: 'buy', symbol: 'BTC', qty: 1, totalAmount: 100, pricePerUnit: 1 }, 'invalid_input_mode'],
    [{ assetType: 'crypto', side: 'buy', symbol: 'BTC', qty: 1, totalAmount: 100, fee: 1 }, 'invalid_input_mode'],
    [{ assetType: 'crypto', side: 'buy', symbol: 'BTC', qty: 1, pricePerUnit: 1, feeInCrypto: 0.1 }, 'invalid_input_mode'],
    [{ assetType: 'crypto', side: 'buy', symbol: 'BTC', qty: 1, totalAmount: 100, feeInCrypto: 1 }, 'invalid_fee'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 1, pricePerUnit: 1, quoteCurrency: 'USDT' }, 'invalid_quote_currency'],
    [{ assetType: 'stock', side: 'buy', symbol: 'X', qty: 'abc', pricePerUnit: 1 }, 'invalid_number'],
  ];
  for (const [body, code] of cases) {
    assert.throws(() => parseTradeRequest(body, { now: NOW }), (err) => err.code === code && err.statusCode === 400, `${code} for ${JSON.stringify(body)}`);
  }
});

// --- service with a fake repository -------------------------------------------------------

function makeRepo({ positions = {}, stocks = ['AAPL'], products = [], txFails = null } = {}) {
  const state = { positions: structuredClone(positions), transactions: [], created: [], deleted: [] };
  const repo = {
    async getPositionHolding(_userId, symbol) {
      const p = state.positions[symbol];
      if (!p) return null;
      let qty = p.qty;
      let cost = p.qty * p.avg;
      for (const tx of state.transactions.filter((t) => t.symbol === symbol)) {
        if (tx.type === 'BUY') { qty += tx.qty; cost += tx.qty * tx.avgCostPerUnit; }
        else { const avg = qty > 0 ? cost / qty : 0; qty -= tx.qty; cost -= tx.qty * avg; }
      }
      return { symbol, category: p.category, currency: p.currency, qty, avgCost: qty > 0 ? cost / qty : 0 };
    },
    async findUsStockSymbol(symbol) {
      return stocks.includes(symbol) ? { symbol } : null;
    },
    async listCoinbaseStableProductsForBase(base) {
      return products.filter((p) => p.baseCurrency === base);
    },
    async createStockPositionFromSymbol({ symbol, qty, avgCostPerUnit }) {
      state.created.push({ symbol, qty, avgCostPerUnit, kind: 'stock' });
      state.positions[symbol] = { category: 'US Stock Assets', currency: 'USD', qty, avg: avgCostPerUnit };
    },
    async createCryptoPositionFromCoinbaseProduct({ productId, qty, avgCostPerUnit }) {
      const [base, quote] = productId.split('-');
      state.created.push({ symbol: base, productId, qty, avgCostPerUnit, kind: 'crypto' });
      state.positions[base] = { category: 'Crypto Assets', currency: quote, qty, avg: avgCostPerUnit };
    },
    async createPositionTransaction(tx) {
      if (txFails) throw new Error(txFails);
      state.transactions.push(tx);
    },
    async deletePosition(_userId, symbol) {
      state.deleted.push(symbol);
      delete state.positions[symbol];
    },
  };
  return { repo, state };
}

test('buying a new stock creates it with 0 holding, then records the purchase', async () => {
  const { repo, state } = makeRepo();
  const out = await createTradeService({ repo }).recordTrade(
    USER,
    { assetType: 'stock', side: 'buy', symbol: 'AAPL', qty: 3, pricePerUnit: 200, fee: 1.5, cashAccountId: 'cash-1' },
    { now: NOW },
  );
  assert.deepEqual(state.created, [{ symbol: 'AAPL', qty: 0, avgCostPerUnit: 0, kind: 'stock' }]);
  assert.equal(state.transactions.length, 1);
  assert.deepEqual(
    { type: state.transactions[0].type, qty: state.transactions[0].qty, price: state.transactions[0].avgCostPerUnit, fee: state.transactions[0].feeFlatTotal, deduct: state.transactions[0].deductCashId, credit: state.transactions[0].creditCashId },
    { type: 'BUY', qty: 3, price: 200, fee: 1.5, deduct: 'cash-1', credit: null },
  );
  assert.equal(out.assetCreated, true);
  assert.deepEqual(out.holding, { symbol: 'AAPL', currency: 'USD', qty: 3, avgCost: 200 });
});

test('buying a new crypto picks the USDT market by default, or the requested quote', async () => {
  const products = [
    { productId: 'SOL-USDC', baseCurrency: 'SOL', quoteCurrency: 'USDC' },
    { productId: 'SOL-USDT', baseCurrency: 'SOL', quoteCurrency: 'USDT' },
  ];
  const a = makeRepo({ products });
  await createTradeService({ repo: a.repo }).recordTrade(USER, { assetType: 'crypto', side: 'buy', symbol: 'SOL', qty: 2, pricePerUnit: 150 }, { now: NOW });
  assert.equal(a.state.created[0].productId, 'SOL-USDT');

  const b = makeRepo({ products });
  await createTradeService({ repo: b.repo }).recordTrade(USER, { assetType: 'crypto', side: 'buy', symbol: 'SOL', qty: 2, pricePerUnit: 150, quoteCurrency: 'USDC' }, { now: NOW });
  assert.equal(b.state.created[0].productId, 'SOL-USDC');
});

test('crypto total-amount buy records net qty and derived price on an existing asset', async () => {
  const { repo, state } = makeRepo({ positions: { BTC: { category: 'Crypto Assets', currency: 'USDT', qty: 1, avg: 50000 } } });
  const out = await createTradeService({ repo }).recordTrade(
    USER,
    { assetType: 'crypto', side: 'buy', symbol: 'BTC', qty: 0.0101, totalAmount: 1000, feeInCrypto: 0.0001 },
    { now: NOW },
  );
  assert.equal(state.created.length, 0, 'existing asset is not re-created');
  assert.ok(Math.abs(state.transactions[0].qty - 0.01) < 1e-12);
  assert.ok(Math.abs(state.transactions[0].avgCostPerUnit - 100000) < 1e-6);
  assert.equal(state.transactions[0].feeFlatTotal, null);
  assert.equal(out.assetCreated, false);
  assert.ok(Math.abs(out.holding.qty - 1.01) < 1e-9);
});

test('sell more than held is rejected without recording anything', async () => {
  const { repo, state } = makeRepo({ positions: { AAPL: { category: 'US Stock Assets', currency: 'USD', qty: 5, avg: 100 } } });
  await assert.rejects(
    createTradeService({ repo }).recordTrade(USER, { assetType: 'stock', side: 'sell', symbol: 'AAPL', qty: 6, pricePerUnit: 120 }, { now: NOW }),
    (err) => err.code === 'insufficient_holding' && err.statusCode === 400 && err.details.held === 5 && err.details.requested === 6,
  );
  assert.equal(state.transactions.length, 0);
});

test('selling an asset never held is rejected and does not create it', async () => {
  const { repo, state } = makeRepo();
  await assert.rejects(
    createTradeService({ repo }).recordTrade(USER, { assetType: 'stock', side: 'sell', symbol: 'AAPL', qty: 1, pricePerUnit: 120 }, { now: NOW }),
    (err) => err.code === 'insufficient_holding' && err.details.held === 0,
  );
  assert.equal(state.created.length, 0);
});

test('valid sell credits the chosen cash account and reduces the holding', async () => {
  const { repo, state } = makeRepo({ positions: { AAPL: { category: 'US Stock Assets', currency: 'USD', qty: 5, avg: 100 } } });
  const out = await createTradeService({ repo }).recordTrade(
    USER,
    { assetType: 'stock', side: 'sell', symbol: 'AAPL', qty: 5, pricePerUnit: 120, fee: 1, cashAccountId: 'cash-1' },
    { now: NOW },
  );
  assert.equal(state.transactions[0].type, 'SELL');
  assert.equal(state.transactions[0].creditCashId, 'cash-1');
  assert.equal(state.transactions[0].deductCashId, null);
  assert.equal(out.holding.qty, 0);
});

test('unknown symbols and asset-type mismatches are rejected', async () => {
  const unknownStock = makeRepo();
  await assert.rejects(
    createTradeService({ repo: unknownStock.repo }).recordTrade(USER, { assetType: 'stock', side: 'buy', symbol: 'ZZZZ', qty: 1, pricePerUnit: 1 }, { now: NOW }),
    (err) => err.code === 'unknown_symbol' && err.statusCode === 404,
  );
  const unknownCoin = makeRepo();
  await assert.rejects(
    createTradeService({ repo: unknownCoin.repo }).recordTrade(USER, { assetType: 'crypto', side: 'buy', symbol: 'NOPE', qty: 1, pricePerUnit: 1 }, { now: NOW }),
    (err) => err.code === 'unknown_symbol',
  );
  const mismatch = makeRepo({ positions: { BTC: { category: 'Crypto Assets', currency: 'USDT', qty: 1, avg: 1 } } });
  await assert.rejects(
    createTradeService({ repo: mismatch.repo }).recordTrade(USER, { assetType: 'stock', side: 'buy', symbol: 'BTC', qty: 1, pricePerUnit: 1 }, { now: NOW }),
    (err) => err.code === 'asset_type_mismatch',
  );
});

test('if recording the purchase fails, the just-created asset is removed again', async () => {
  const { repo, state } = makeRepo({ txFails: 'Cash currency mismatch: expected USD for AAPL.' });
  await assert.rejects(
    createTradeService({ repo }).recordTrade(USER, { assetType: 'stock', side: 'buy', symbol: 'AAPL', qty: 1, pricePerUnit: 1, cashAccountId: 'eur-cash' }, { now: NOW }),
    (err) => err.code === 'trade_rejected' && /Cash currency mismatch/.test(err.message),
  );
  assert.deepEqual(state.deleted, ['AAPL']);
  assert.equal(state.positions.AAPL, undefined);
});
