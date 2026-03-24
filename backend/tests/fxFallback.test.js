import test from 'node:test';
import assert from 'node:assert/strict';
import { fxRatesMissingAny, mergeUsdPerUnitRates } from '../src/lib/fx.js';

test('fxRatesMissingAny is false when all codes present', () => {
  const rates = { USD: 1, CNY: 0.14, SGD: 0.74 };
  assert.equal(fxRatesMissingAny(rates, ['CNY', 'SGD']), false);
});

test('fxRatesMissingAny is true when a code is missing', () => {
  const rates = { USD: 1, CNY: 0.14 };
  assert.equal(fxRatesMissingAny(rates, ['CNY', 'SGD']), true);
});

test('mergeUsdPerUnitRates prefers primary then fills from secondary', () => {
  const merged = mergeUsdPerUnitRates(
    { USD: 1, CNY: 0.1 },
    { USD: 1, CNY: 0.2, SGD: 0.73 },
  );
  assert.equal(merged.CNY, 0.1);
  assert.equal(merged.SGD, 0.73);
});

test('mergeUsdPerUnitRates uses secondary when primary lacks a currency', () => {
  const merged = mergeUsdPerUnitRates({ USD: 1 }, { USD: 1, EUR: 1.05 });
  assert.equal(merged.EUR, 1.05);
});
