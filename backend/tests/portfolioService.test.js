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
