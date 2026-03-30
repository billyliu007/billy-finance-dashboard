import test from 'node:test';
import assert from 'node:assert/strict';
import { computePositionTxCashDelta, computePositionTxCashReverseDelta } from '../src/services/portfolioCashAdjustments.js';

test('computePositionTxCashDelta: BUY deducts gross + fee', () => {
  assert.equal(
    computePositionTxCashDelta({ type: 'BUY', qty: 2, pricePerUnit: 10, feeFlat: 1.5 }),
    -(20 + 1.5),
  );
});

test('computePositionTxCashDelta: SELL credits gross - fee', () => {
  assert.equal(
    computePositionTxCashDelta({ type: 'SELL', qty: 2, pricePerUnit: 10, feeFlat: 1.5 }),
    20 - 1.5,
  );
});

test('computePositionTxCashReverseDelta is exact inverse', () => {
  const args = { type: 'SELL', qty: 0.5, pricePerUnit: 70000, feeFlat: 10 };
  assert.equal(computePositionTxCashReverseDelta(args), -computePositionTxCashDelta(args));
});

