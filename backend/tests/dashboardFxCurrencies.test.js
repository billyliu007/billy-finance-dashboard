import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardFxCurrencies } from '../src/services/dashboardService.js';

test('CNY base with only USDT cash still requests CNY (regression)', () => {
  const codes = buildDashboardFxCurrencies([{ currency: 'USDT', balance: 3829.01 }], 'CNY');
  assert.ok(codes.includes('CNY'));
  assert.ok(codes.includes('USDT'));
});

test('non-CNY base requests the base currency and CNY', () => {
  const codes = buildDashboardFxCurrencies([{ currency: 'usd' }], 'SGD');
  assert.deepEqual(new Set(codes), new Set(['USD', 'SGD', 'CNY']));
});

test('no cash: still requests base and CNY, no duplicates or blanks', () => {
  assert.deepEqual(buildDashboardFxCurrencies([], 'CNY'), ['CNY']);
  assert.deepEqual(
    buildDashboardFxCurrencies([{ currency: 'CNY' }, { currency: ' cny ' }, { currency: '' }, {}], 'CNY'),
    ['CNY'],
  );
});
