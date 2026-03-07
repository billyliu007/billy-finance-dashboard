import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNetWorthPayload } from '../src/services/netWorthService.js';

/**
 * Build mock sheet data matching backend config cell refs.
 * Net Worth: B3, B12, B11, B17 (detailItems)
 * Forex: C1 (SGD), C2 (USD)
 * Portfolio: D28/F28, D36/F36, etc. (assets)
 * Cashflow: col A date, col B netWorth
 */
function mockNetWorthSheet() {
  const headers = Array(26).fill('');
  const rows = Array(20).fill(null).map(() => Array(26).fill(''));
  rows[1][1] = '10000';   // B3 - sgd_cash (row 3 = rows[1])
  rows[10][1] = '5000';   // B12 - USD_cash
  rows[9][1] = '2000';    // B11 - USDT/USDC_cash
  rows[15][1] = '3000';   // B17 - cny_cash_debt (liability)
  return { headers, rows };
}

function mockForexSheet() {
  const headers = ['', '', '1.34'];  // C1 = SGD rate
  const rows = [['', '', '7.2']];    // C2 = USD rate
  return { headers, rows };
}

function mockPortfolioSheet() {
  const headers = Array(10).fill('');
  const rows = Array(50).fill(null).map(() => Array(10).fill(''));
  rows[26][3] = '0.5';   // D28 - BTC qty (row 28 = rows[26])
  rows[26][5] = '60000'; // F28 - BTC current price
  return { headers, rows };
}

function mockCashflowSheet() {
  const headers = ['Date', 'Net Worth'];
  const rows = [
    ['2024-01-01', '100000'],
    ['2024-02-01', '105000'],
    ['2024-03-01', '102000'],
  ];
  return { headers, rows };
}

test('buildNetWorthPayload returns overview and performance structure', () => {
  const payload = buildNetWorthPayload({
    netWorthSheet: mockNetWorthSheet(),
    forexSheet: mockForexSheet(),
    portfolioSheet: mockPortfolioSheet(),
    cashflowSheet: mockCashflowSheet(),
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
    netWorthSheet: mockNetWorthSheet(),
    forexSheet: mockForexSheet(),
    portfolioSheet: mockPortfolioSheet(),
    cashflowSheet: mockCashflowSheet(),
  });

  // SGD 10000 * 1.34 + USD (5000+2000) * 7.2 + USD positions (0.5*60000=30000) * 7.2 - CNY debt 3000
  // = 13400 + 50400 + 216000 - 3000 = 276800
  assert.ok(payload.overview.totalNetWorth > 0);
  assert.ok(payload.overview.hasData);
});

test('buildNetWorthPayload normalizes RMB to CNY in forex rates', () => {
  const forexWithRmb = {
    headers: ['', '', '1.34'],
    rows: [['', '', '7.2']],
  };
  const payload = buildNetWorthPayload({
    netWorthSheet: mockNetWorthSheet(),
    forexSheet: forexWithRmb,
    portfolioSheet: mockPortfolioSheet(),
    cashflowSheet: mockCashflowSheet(),
  });
  assert.ok(payload.overview.componentValues.length > 0);
});

test('buildNetWorthPayload handles empty cashflow', () => {
  const emptyCashflow = { headers: ['Date', 'Net Worth'], rows: [] };
  const payload = buildNetWorthPayload({
    netWorthSheet: mockNetWorthSheet(),
    forexSheet: mockForexSheet(),
    portfolioSheet: mockPortfolioSheet(),
    cashflowSheet: emptyCashflow,
  });

  assert.strictEqual(payload.performance.hasData, false);
  assert.strictEqual(payload.performance.summary.latestPeriodChangePct, 0);
  assert.strictEqual(payload.performance.cashflowData.length, 0);
});
