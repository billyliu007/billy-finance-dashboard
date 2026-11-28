import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioPayload, buildTradingPerformanceHoldingsSlice } from '../src/services/portfolioService.js';

function samplePositions() {
  return [
    { symbol: 'BTC', name: 'BTC', category: 'Crypto Assets', qty: 0.5, purchasePrice: 60000 },
    { symbol: 'QQQ', name: 'QQQ', category: 'US Stock Assets', qty: 10, purchasePrice: 500 },
  ];
}

test('buildPortfolioPayload computes table rows and totals', () => {
  const payload = buildPortfolioPayload({
    positions: samplePositions(),
    stockQuotes: { QQQ: { price: 520, source: 'finnhub', timestamp: Date.now() } },
    cryptoQuotes: { BTC: { price: 62000, source: 'coinbase', timestamp: Date.now() } },
  });
  assert.strictEqual(payload.isEmpty, false);
  assert.ok(payload.totals.value > 0);
  assert.ok(payload.tableRows.length >= 2);
});

test('buildPortfolioPayload handles missing live quotes', () => {
  const payload = buildPortfolioPayload({
    positions: samplePositions(),
    stockQuotes: {},
    cryptoQuotes: {},
  });
  assert.strictEqual(payload.tableRows[0].priceSource, 'unavailable');
});

test('buildTradingPerformanceHoldingsSlice returns minimal rows and matches visibility', () => {
  const slice = buildTradingPerformanceHoldingsSlice({ positions: samplePositions() });
  assert.strictEqual(slice.isEmpty, false);
  assert.strictEqual(slice.tableRows.length, 2);
  const btc = slice.tableRows.find((r) => r.symbol === 'BTC');
  assert.ok(btc);
  assert.strictEqual(btc.currency, 'USD');
  assert.ok(!('currentPrice' in btc));
});

test('archived assets are hidden from holdings but keep their realized P/L in totals', () => {
  const positions = [
    ...samplePositions(),
    // ADA after archiving: emptied row, archived round's sales still in the realized aggregates.
    { symbol: 'ADA', name: 'ADA', category: 'Crypto Assets', qty: 0, purchasePrice: 0, archivedAt: '2026-11-29T00:00:00Z', realizedPnl: -120, sellCost: 500 },
  ];
  const payload = buildPortfolioPayload({ positions, stockQuotes: {}, cryptoQuotes: { ADA: { price: 0.4, source: 'coinbase', timestamp: Date.now() } } });
  assert.equal(payload.tableRows.some((r) => r.symbol === 'ADA'), false);
  assert.equal(payload.totals.realizedPnl, -120);
  const slice = buildTradingPerformanceHoldingsSlice({ positions });
  assert.equal(slice.tableRows.some((r) => r.symbol === 'ADA'), false);
});

test('applyTransactionAggregatesToPositions carries the current round transaction count', async () => {
  const { applyTransactionAggregatesToPositions } = await import('../src/services/dashboardService.js');
  const [withTx, empty] = applyTransactionAggregatesToPositions(
    [{ symbol: 'ADA', qty: 0, purchasePrice: 0 }, { symbol: 'NVDA', qty: 0, purchasePrice: 0 }],
    [{ symbol: 'ADA', activeTxCount: 3 }, { symbol: 'NVDA', activeTxCount: 0 }],
  );
  assert.equal(withTx.activeTxCount, 3);
  assert.equal(empty.activeTxCount, 0);
  const payload = buildPortfolioPayload({ positions: [{ ...withTx, category: 'Crypto Assets', realizedPnl: 5 }], stockQuotes: {}, cryptoQuotes: {} });
  assert.equal(payload.tableRows[0].activeTxCount, 3);
});
