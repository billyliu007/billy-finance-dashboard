import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAvailableSymbolsFromTransactions,
  computeAssetSummaryMetrics,
  normalizeTradingSymbolParam,
} from '../src/services/profitabilityService.js';

test('normalizeTradingSymbolParam trims and uppercases', () => {
  assert.equal(normalizeTradingSymbolParam(' tsla '), 'TSLA');
  assert.equal(normalizeTradingSymbolParam(''), null);
  assert.equal(normalizeTradingSymbolParam(null), null);
});

test('collectAvailableSymbolsFromTransactions returns sorted unique SELL symbols', () => {
  const txs = [
    { type: 'BUY', symbol: 'AAPL' },
    { type: 'SELL', symbol: 'tsla' },
    { type: 'SELL', symbol: 'AAPL' },
    { type: 'sell', symbol: 'MSFT' },
  ];
  assert.deepEqual(collectAvailableSymbolsFromTransactions(txs), ['AAPL', 'MSFT', 'TSLA']);
});

test('collectAvailableSymbolsFromTransactions empty list', () => {
  assert.deepEqual(collectAvailableSymbolsFromTransactions([]), []);
});

test('computeAssetSummaryMetrics volume-weighted averages and mean pnl per trade', () => {
  const trades = [
    {
      qty: 10,
      cost: 1000,
      proceeds: 1100,
      pnl: 100,
      pnlUsd: 100,
      currency: 'USD',
    },
    {
      qty: 10,
      cost: 2000,
      proceeds: 1800,
      pnl: -200,
      pnlUsd: -200,
      currency: 'USD',
    },
  ];
  const m = computeAssetSummaryMetrics(trades);
  assert.equal(m.tradeCount, 2);
  assert.equal(m.totalRealizedPnlUsd, -100);
  assert.equal(m.avgCostBasisPerUnit, 150);
  assert.equal(m.avgSoldPricePerUnit, 145);
  assert.equal(m.avgPnlUsdPerTrade, -50);
  assert.equal(m.currency, 'USD');
});

test('computeAssetSummaryMetrics empty trades', () => {
  const m = computeAssetSummaryMetrics([]);
  assert.equal(m.tradeCount, 0);
  assert.equal(m.totalRealizedPnlUsd, 0);
  assert.equal(m.avgCostBasisPerUnit, null);
  assert.equal(m.avgSoldPricePerUnit, null);
  assert.equal(m.avgPnlUsdPerTrade, null);
  assert.equal(m.currency, 'USD');
});
