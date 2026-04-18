import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterExpectedPriceTargetsForExternalApi,
  mapTargetPricesToExpectedPrices,
} from '../src/repositories/whatIfScenarioRepository.js';

test('mapTargetPricesToExpectedPrices maps worst and exit; omits exit when second price is zero', () => {
  const out = mapTargetPricesToExpectedPrices([
    { symbol: 'AAPL', currency: 'USD', targetPrice: 100, targetPrice2: 0 },
    { symbol: 'XOM', currency: 'USD', targetPrice: 50, targetPrice2: 55 },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { symbol: 'AAPL', currency: 'USD', worstPrice: 100, exitPrice: null });
  assert.deepEqual(out[1], { symbol: 'XOM', currency: 'USD', worstPrice: 50, exitPrice: 55 });
});

test('mapTargetPricesToExpectedPrices handles non-array input', () => {
  assert.deepEqual(mapTargetPricesToExpectedPrices(null), []);
  assert.deepEqual(mapTargetPricesToExpectedPrices(undefined), []);
});

test('filterExpectedPriceTargetsForExternalApi drops zero-holding symbols without hypo buys', () => {
  const targets = [
    { symbol: 'AAPL', targetPrice: 1, targetPrice2: 0, currency: 'USD' },
    { symbol: 'DEAD', targetPrice: 2, targetPrice2: 0, currency: 'USD' },
  ];
  const purchases = [{ symbol: 'MSFT', qty: 1, buyPrice: 10, currency: 'USD' }];
  const tableRows = [{ symbol: 'AAPL', qty: 5 }];
  const out = filterExpectedPriceTargetsForExternalApi(targets, purchases, tableRows);
  assert.deepEqual(
    out.map((r) => r.symbol),
    ['AAPL'],
  );
});

test('filterExpectedPriceTargetsForExternalApi keeps row when hypo buy exists even with zero holding', () => {
  const targets = [{ symbol: 'MSFT', targetPrice: 1, targetPrice2: 0, currency: 'USD' }];
  const purchases = [{ symbol: 'MSFT', qty: 2, buyPrice: 10, currency: 'USD' }];
  const out = filterExpectedPriceTargetsForExternalApi(targets, purchases, []);
  assert.equal(out.length, 1);
  assert.strictEqual(out[0].symbol, 'MSFT');
});

test('filterExpectedPriceTargetsForExternalApi ignores hypo rows with zero qty', () => {
  const targets = [{ symbol: 'X', targetPrice: 1, targetPrice2: 0, currency: 'USD' }];
  const purchases = [{ symbol: 'X', qty: 0, buyPrice: 1, currency: 'USD' }];
  const out = filterExpectedPriceTargetsForExternalApi(targets, purchases, []);
  assert.equal(out.length, 0);
});
