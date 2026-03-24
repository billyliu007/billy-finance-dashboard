import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWhatIfFromData } from '../src/services/whatIfScenarioService.js';

test('computeWhatIfFromData applies target price over market and buy-price fallback', () => {
  const result = computeWhatIfFromData({
    scenario: { id: 's1', name: 'Base', isActive: true },
    targetPrices: [{ symbol: 'AAPL', targetPrice: 220 }],
    hypotheticalPurchases: [
      { symbol: 'AAPL', qty: 2, buyPrice: 180, currency: 'USD' },
      { symbol: 'MSFT', qty: 1, buyPrice: 300, currency: 'USD' },
    ],
    baselineRows: [
      {
        symbol: 'AAPL',
        name: 'Apple',
        category: 'US Stock Assets',
        currency: 'USD',
        qty: 10,
        purchasePrice: 100,
        totalPurchaseCost: 1000,
        currentPrice: 200,
      },
    ],
    baselineTotalValue: 2000,
    baselineTotalCost: 1000,
    fetchedPriceMap: new Map(),
  });

  const aapl = result.rows.find((row) => row.symbol === 'AAPL');
  const msft = result.rows.find((row) => row.symbol === 'MSFT');
  assert.ok(aapl);
  assert.ok(msft);
  assert.equal(aapl.qty, 12);
  assert.equal(Math.round(aapl.avgCost * 100) / 100, 113.33);
  assert.equal(aapl.scenarioPrice, 220);
  assert.equal(aapl.scenarioPriceSource, 'target-price');
  assert.equal(msft.scenarioPrice, 300);
  assert.equal(msft.scenarioPriceSource, 'buy-price-fallback');
});

test('computeWhatIfFromData uses fetched market price for new symbol without target', () => {
  const result = computeWhatIfFromData({
    scenario: { id: 's1', name: 'Base', isActive: true },
    targetPrices: [],
    hypotheticalPurchases: [{ symbol: 'NVDA', qty: 1, buyPrice: 500, currency: 'USD' }],
    baselineRows: [],
    baselineTotalValue: 0,
    baselineTotalCost: 0,
    fetchedPriceMap: new Map([['NVDA', { price: 700, source: 'market-stock' }]]),
  });
  const nvda = result.rows.find((row) => row.symbol === 'NVDA');
  assert.ok(nvda);
  assert.equal(nvda.scenarioPrice, 700);
  assert.equal(nvda.scenarioValue, 700);
  assert.equal(nvda.scenarioPriceSource, 'market-stock');
});

test('computeWhatIfFromData computes base-currency portfolio totals via FX', () => {
  const result = computeWhatIfFromData({
    scenario: { id: 's1', name: 'Base', isActive: true },
    targetPrices: [{ symbol: 'BTC', targetPrice: 80000 }],
    hypotheticalPurchases: [],
    baselineRows: [
      {
        symbol: 'BTC',
        name: 'Bitcoin',
        category: 'Crypto Assets',
        currency: 'USD',
        qty: 1,
        purchasePrice: 50000,
        totalPurchaseCost: 50000,
        currentPrice: 70000,
      },
    ],
    baselineTotalValue: 70000,
    baselineTotalCost: 50000,
    baseCurrency: 'CNY',
    fxRates: { USD: 1, CNY: 0.14 },
    fetchedPriceMap: new Map(),
  });
  // 1 USD => ~7.142857 CNY
  assert.ok(result.portfolioBaseTotals);
  assert.equal(result.portfolioBaseTotals.baseCurrency, 'CNY');
  assert.ok(result.portfolioBaseTotals.deltaValue > 70000);
  assert.ok(result.portfolioBaseTotals.hypotheticalCostBase >= 0);
});
