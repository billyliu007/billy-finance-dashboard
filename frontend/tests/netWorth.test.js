import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateComputedTotals,
  buildDetailRows,
  buildFxRates,
  computeUsdPositionsTotal,
} from '../src/utils/netWorth.js';

test('buildFxRates reads configured forex cells and normalizes RMB to CNY', () => {
  const headers = ['A', 'B', '1.34'];
  const rows = [['', '', '5.12']];
  const rates = buildFxRates(headers, rows, [
    { currency: 'SGD', cellRef: 'C1' },
    { currency: 'USD', cellRef: 'C2' },
    { currency: 'RMB', cellRef: 'C1' },
  ]);

  assert.equal(rates.CNY, 1.34);
  assert.equal(rates.SGD, 1.34);
  assert.equal(rates.USD, 5.12);
});

test('buildDetailRows converts liabilities to negative and computes CNY value', () => {
  const headers = ['A', 'B', '100'];
  const rows = [['', '', '50']];
  const detailItems = [
    { key: 'cash_usd', cellRef: 'C1', currency: 'USD', type: 'asset' },
    { key: 'debt_cny', cellRef: 'C2', currency: 'CNY', type: 'liability' },
  ];

  const findComponentValue = (_headers, _rows, item) => ({
    found: true,
    value: item.key === 'cash_usd' ? 100 : 50,
  });

  const rowsOut = buildDetailRows(headers, rows, detailItems, findComponentValue, {}, { CNY: 1, USD: 7.2 });

  assert.equal(rowsOut[0].value, 100);
  assert.equal(rowsOut[0].cnyValue, 720);
  assert.equal(rowsOut[1].value, -50);
  assert.equal(rowsOut[1].cnyValue, -50);
});

test('computeUsdPositionsTotal sums qty * current price for positions with data', () => {
  const headers = ['A', 'B', 'C', '2', 'E', '300'];
  const rows = [['', '', '150', '1', '', '']];
  const assets = [
    { qtyCell: 'D1', currentPriceCell: 'F1' },
    { qtyCell: 'D2', currentPriceCell: 'C2' },
  ];

  const total = computeUsdPositionsTotal(assets, headers, rows);
  assert.equal(total, 750);
});

test('aggregateComputedTotals merges cash and positions with fx rates', () => {
  const detailRows = [
    { type: 'asset', currency: 'SGD', value: 100, cnyValue: 130 },
    { type: 'asset', currency: 'USD', value: 200, cnyValue: 1400 },
    { type: 'liability', currency: 'CNY', value: -50, cnyValue: -50 },
  ];

  const totals = aggregateComputedTotals(detailRows, 300, { CNY: 1, USD: 7, SGD: 1.3 });

  assert.equal(totals.sgd_assets_in_cny.value, 130);
  assert.equal(totals.cny_assets_total.value, -50);
  assert.equal(totals.usd_assets_in_cny.value, 3500);
  assert.equal(totals.usd_assets_in_cny.found, true);
});
