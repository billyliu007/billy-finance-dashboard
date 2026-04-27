import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSettingsExportPayload,
  normalizeSettingsImportPayload,
  REPLACE_ALL_DATASET_ORDER,
  SETTINGS_BACKUP_VERSION,
} from '../src/services/settingsDataTransferService.js';

function sampleBackup() {
  return {
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: '2026-04-27T10:00:00.000Z',
    cash: [{ id: '11111111-1111-4111-8111-111111111111', currency: 'usd', name: 'Broker', balance: 1000.5 }],
    netWorthHistory: [
      {
        date: '2026-04-26',
        recordedAtUtc: '2026-04-26T00:00:00.000Z',
        netWorthCny: 50000,
        netWorthUsd: 7000,
      },
    ],
    holdings: [{ symbol: 'qqq', category: 'US Stock Assets', currency: 'usd', qty: 2, purchasePrice: 450 }],
    transactions: [
      {
        symbol: 'qqq',
        type: 'BUY',
        affectsHoldings: true,
        txDate: '2026-04-25',
        qty: 2,
        avgCostPerUnit: 450,
        feeFlat: 2.5,
        notes: 'Initial buy',
        deductCashId: '11111111-1111-4111-8111-111111111111',
      },
    ],
    scenarioPlanning: {
      scenarios: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Base case',
          isActive: true,
          targetPrices: [{ symbol: 'QQQ', targetPrice: 400, targetPrice2: 500, currency: 'USD' }],
          hypotheticalPurchases: [{ symbol: 'QQQ', qty: 1, buyPrice: 420, currency: 'USD', comment: 'DCA' }],
          hypotheticalSales: [{ symbol: 'QQQ', qty: 1, sellPrice: 510, feeFlat: 1.2, currency: 'USD', comment: null }],
        },
      ],
    },
  };
}

test('buildSettingsExportPayload returns expected shape with scenarios', () => {
  const payload = buildSettingsExportPayload({
    cashRows: [{ id: '22222222-2222-4222-8222-222222222222', currency: 'usd', name: 'Wallet', balance: 200 }],
    netWorthRows: [{ date: '2026-04-27', recordedAtUtc: '2026-04-27T00:00:00Z', netWorthCny: 1, netWorthUsd: 2 }],
    holdingsRows: [{ symbol: 'btc', category: 'Crypto Assets', currency: 'usdt', qty: 1, purchasePrice: 90000 }],
    transactionRows: [
      {
        symbol: 'btc',
        type: 'SELL',
        affectsHoldings: false,
        txDate: '2026-04-20',
        qty: 0.1,
        avgCostPerUnit: 95000,
        feeFlat: 1,
        costBasisPerUnit: 80000,
        creditCashId: '22222222-2222-4222-8222-222222222222',
      },
    ],
    scenarios: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Base case',
        isActive: true,
        targetPrices: [],
        hypotheticalPurchases: [],
        hypotheticalSales: [],
      },
    ],
  });

  assert.strictEqual(payload.version, SETTINGS_BACKUP_VERSION);
  assert.ok(payload.exportedAt);
  assert.deepStrictEqual(Object.keys(payload).sort(), [
    'cash',
    'exportedAt',
    'holdings',
    'netWorthHistory',
    'scenarioPlanning',
    'transactions',
    'version',
  ]);
  assert.deepStrictEqual(payload.cash[0], {
    id: '22222222-2222-4222-8222-222222222222',
    currency: 'USD',
    name: 'Wallet',
    balance: 200,
  });
  assert.deepStrictEqual(payload.holdings[0].symbol, 'BTC');
  assert.deepStrictEqual(payload.transactions[0].affectsHoldings, false);
  assert.deepStrictEqual(payload.transactions[0].creditCashId, '22222222-2222-4222-8222-222222222222');
  assert.strictEqual(payload.scenarioPlanning.scenarios.length, 1);
});

test('normalizeSettingsImportPayload accepts valid backup with scenarios', () => {
  const normalized = normalizeSettingsImportPayload(sampleBackup());
  assert.strictEqual(normalized.version, SETTINGS_BACKUP_VERSION);
  assert.strictEqual(normalized.cash.length, 1);
  assert.strictEqual(normalized.netWorthHistory.length, 1);
  assert.strictEqual(normalized.holdings.length, 1);
  assert.strictEqual(normalized.transactions.length, 1);
  assert.strictEqual(normalized.cash[0].currency, 'USD');
  assert.strictEqual(normalized.holdings[0].symbol, 'QQQ');
  assert.strictEqual(normalized.scenarioPlanning.scenarios.length, 1);
});

test('normalizeSettingsImportPayload rejects unsupported version', () => {
  const bad = sampleBackup();
  bad.version = 999;
  assert.throws(() => normalizeSettingsImportPayload(bad), /Unsupported backup version/i);
});

test('normalizeSettingsImportPayload rejects malformed arrays', () => {
  const bad = sampleBackup();
  bad.holdings = null;
  assert.throws(() => normalizeSettingsImportPayload(bad), /holdings must be an array/i);
});

test('normalizeSettingsImportPayload rejects invalid transaction rows', () => {
  const bad = sampleBackup();
  bad.transactions = [{ ...bad.transactions[0], type: 'TRANSFER' }];
  assert.throws(() => normalizeSettingsImportPayload(bad), /type must be BUY or SELL/i);
});

test('replace-all mode and dataset order are stable', () => {
  assert.deepStrictEqual(REPLACE_ALL_DATASET_ORDER, [
    'holdings',
    'cash',
    'transactions',
    'netWorthHistory',
    'scenarioPlanning',
  ]);
});
