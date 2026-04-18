import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTargetPricesToExpectedPrices } from '../src/repositories/whatIfScenarioRepository.js';

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
