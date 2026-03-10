import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetWorthPayload } from '../src/services/netWorthService.js';

function mockCashComponents() {
  return [
    { id: '1', currency: 'SGD', name: 'SGD Cash', balance: 10000 },
    { id: '2', currency: 'USD', name: 'USD Cash', balance: 7000 },
    { id: '3', currency: 'CNY', name: 'CNY Debt', balance: -3000 },
  ];
}

function mockPositions() {
  return [{ symbol: 'BTC', name: 'BTC', category: 'Crypto Assets', qty: 0.5, purchasePrice: 60000 }];
}

function mockHistory() {
  return [
    { date: '2024-01-01', netWorth: 100000 },
    { date: '2024-02-01', netWorth: 105000 },
    { date: '2024-03-01', netWorth: 102000 },
  ];
}

test('buildNetWorthPayload returns overview and performance structure', () => {
  const payload = buildNetWorthPayload({
    cashComponents: mockCashComponents(),
    positions: mockPositions(),
    history: mockHistory(),
    stockQuotes: {},
    cryptoQuotes: { BTC: { price: 62000 } },
    fxRatesOverride: { SGD: 1.34, USD: 7.2 },
  });

  assert.ok(payload.overview);
  assert.ok(payload.performance);
  assert.strictEqual(typeof payload.overview.totalNetWorth, 'number');
  assert.ok(Array.isArray(payload.overview.componentValues));
  assert.ok(Array.isArray(payload.overview.cashRows));
  assert.ok(Array.isArray(payload.performance.cashflowData));
  assert.ok(Array.isArray(payload.performance.derivedSeries));
});

test('buildNetWorthPayload computes total net worth from cash and positions', () => {
  const payload = buildNetWorthPayload({
    cashComponents: mockCashComponents(),
    positions: mockPositions(),
    history: mockHistory(),
    stockQuotes: {},
    cryptoQuotes: { BTC: { price: 62000 } },
    fxRatesOverride: { SGD: 1.34, USD: 7.2 },
  });

  assert.ok(payload.overview.totalNetWorth > 0);
  assert.ok(payload.overview.hasData);
});

test('buildNetWorthPayload handles fxRatesOverride inputs', () => {
  const payload = buildNetWorthPayload({
    cashComponents: mockCashComponents(),
    positions: mockPositions(),
    history: mockHistory(),
    stockQuotes: {},
    cryptoQuotes: { BTC: { price: 62000 } },
    fxRatesOverride: { SGD: 1.34, USD: 7.2, RMB: 1 },
  });
  assert.ok(payload.overview.componentValues.length > 0);
});

test('buildNetWorthPayload handles empty history', () => {
  const payload = buildNetWorthPayload({
    cashComponents: mockCashComponents(),
    positions: mockPositions(),
    history: [],
    stockQuotes: {},
    cryptoQuotes: { BTC: { price: 62000 } },
    fxRatesOverride: { SGD: 1.34, USD: 7.2 },
  });

  assert.strictEqual(payload.performance.hasData, false);
  assert.strictEqual(payload.performance.summary.latestPeriodChangePct, 0);
  assert.strictEqual(payload.performance.cashflowData.length, 0);
});
