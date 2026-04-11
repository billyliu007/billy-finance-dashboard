import test from 'node:test';
import assert from 'node:assert/strict';
import { hashApiTokenPlain, readBearerToken } from '../src/lib/apiTokenCrypto.js';
import { parseIncludeHistoricalSellsQuery } from '../src/lib/externalV1Query.js';

test('readBearerToken parses Authorization header', () => {
  assert.strictEqual(readBearerToken('Bearer abc.def'), 'abc.def');
  assert.strictEqual(readBearerToken('bearer token123'), 'token123');
  assert.strictEqual(readBearerToken('Bearer   spaced'), 'spaced');
  assert.strictEqual(readBearerToken(null), null);
  assert.strictEqual(readBearerToken('Basic x'), null);
});

test('hashApiTokenPlain is stable for the same pepper', (t) => {
  const prev = process.env.API_TOKEN_PEPPER;
  t.after(() => {
    if (prev === undefined) {
      delete process.env.API_TOKEN_PEPPER;
    } else {
      process.env.API_TOKEN_PEPPER = prev;
    }
  });
  process.env.API_TOKEN_PEPPER = 'unit-test-pepper';
  const a = hashApiTokenPlain('bfpat_same');
  const b = hashApiTokenPlain('bfpat_same');
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 64);
  assert.notStrictEqual(hashApiTokenPlain('bfpat_other'), a);
});

test('parseIncludeHistoricalSellsQuery', () => {
  assert.strictEqual(parseIncludeHistoricalSellsQuery({}), false);
  assert.strictEqual(parseIncludeHistoricalSellsQuery(undefined), false);
  assert.strictEqual(parseIncludeHistoricalSellsQuery({ includeHistoricalSells: 'true' }), true);
  assert.strictEqual(parseIncludeHistoricalSellsQuery({ includeHistoricalSells: '1' }), true);
  assert.strictEqual(parseIncludeHistoricalSellsQuery({ includeHistoricalSells: 'YES' }), true);
  assert.strictEqual(parseIncludeHistoricalSellsQuery({ includeHistoricalSells: 'false' }), false);
});
