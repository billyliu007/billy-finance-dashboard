import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('listUsersForSnapshots aliases base_currency as baseCurrency', () => {
  const filePath = resolve(process.cwd(), 'src/repositories/userRepository.js');
  const source = readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /listUsersForSnapshots[\s\S]*AS\s+"baseCurrency"/,
    'Expected listUsersForSnapshots query to alias base_currency as "baseCurrency".',
  );
});

test('runDailySnapshots reads user.baseCurrency (not user.base_currency)', () => {
  const filePath = resolve(process.cwd(), 'src/services/snapshotService.js');
  const source = readFileSync(filePath, 'utf8');

  assert.match(
    source,
    /user\.baseCurrency/,
    'Expected snapshot service to use user.baseCurrency.',
  );
  assert.doesNotMatch(
    source,
    /user\.base_currency/,
    'snapshot service should not reference user.base_currency.',
  );
});
