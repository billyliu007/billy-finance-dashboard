import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecurringBuyInput, recurringBuyCashDelta } from '../src/lib/recurringBuy.js';
import { buildSettingsExportPayload, normalizeSettingsImportPayload } from '../src/services/settingsDataTransferService.js';

const VALID = { name: ' Plan ', txDate: '2026-09-01', totalInvested: '6663.647', totalQty: '0.08' };

test('derives quantity and average cost from running totals', () => {
  assert.deepEqual(parseRecurringBuyInput(VALID), {
    name: 'Plan', txDate: '2026-09-01', qty: 0.08, avgCostPerUnit: 83295.5875, totalInvested: 6663.647, cashId: null,
  });
});

test('rejects missing or invalid input', () => {
  for (const patch of [
    { name: '' }, { name: 'x'.repeat(101) }, { txDate: '2026-02-30' }, { txDate: '' },
    { totalInvested: 0 }, { totalInvested: 'abc' }, { totalInvested: null }, { totalInvested: true },
    { totalQty: -1 }, { totalQty: '' }, { totalQty: Infinity }, { totalQty: 1e-9 },
  ]) {
    assert.throws(() => parseRecurringBuyInput({ ...VALID, ...patch }), undefined, JSON.stringify(patch));
  }
});

test('only the difference moves in cash', () => {
  assert.equal(recurringBuyCashDelta(0, 100), -100);
  assert.equal(recurringBuyCashDelta(6663.647, 7363.647), -700);
  assert.equal(recurringBuyCashDelta(7363.647, 7263.647), 100);
  assert.equal(recurringBuyCashDelta(6663.647, 6663.647), 0);
});

test('backup keeps the recurring marker; older backups default to false; sells never get it', () => {
  const row = { symbol: 'BTC', type: 'BUY', affectsHoldings: true, txDate: '2026-09-01', qty: 1, avgCostPerUnit: 2, notes: 'Plan' };
  const payload = buildSettingsExportPayload({
    cashRows: [], netWorthRows: [], holdingsRows: [],
    transactionRows: [{ ...row, isRecurring: true }, row, { ...row, type: 'SELL', isRecurring: true }],
  });
  const normalized = normalizeSettingsImportPayload(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(normalized.transactions.map((t) => t.isRecurring), [true, false, false]);
  delete payload.transactions[1].isRecurring;
  assert.equal(normalizeSettingsImportPayload(payload).transactions[1].isRecurring, false);
});
