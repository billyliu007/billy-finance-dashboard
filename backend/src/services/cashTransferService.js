import { normalizeCurrencyCode } from '../lib/number.js';
import { findCashById, transferCashBetweenAccounts } from '../repositories/financeRepository.js';
import { getLiveFxRates } from './marketDataService.js';

/**
 * Live cross rate: multiply an amount in `fromCurrency` by this to get `toCurrency`.
 * Uses Frankfurter-derived CNY legs (same as net worth FX).
 */
export async function getCrossFxRate(fromCurrency, toCurrency) {
  const fromN = normalizeCurrencyCode(fromCurrency);
  const toN = normalizeCurrencyCode(toCurrency);
  if (fromN === toN) {
    return { rate: 1, from: fromN, to: toN };
  }
  const fx = await getLiveFxRates([fromN, toN]);
  const map = { CNY: 1, ...fx };
  const rFrom = fromN === 'CNY' ? 1 : map[fromN];
  const rTo = toN === 'CNY' ? 1 : map[toN];
  if (!Number.isFinite(rFrom) || !Number.isFinite(rTo) || rFrom <= 0 || rTo <= 0) {
    return { rate: null, from: fromN, to: toN };
  }
  return { rate: rFrom / rTo, from: fromN, to: toN };
}

function roundMoney(n, decimals = 8) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * @param {string} userId
 * @param {{ fromCashId: string, toCashId: string, amount: number, fxRateOverride?: number | null }} input
 */
export async function runCashTransfer(userId, { fromCashId, toCashId, amount, fxRateOverride }) {
  const fromAcct = await findCashById(userId, fromCashId);
  const toAcct = await findCashById(userId, toCashId);
  if (!fromAcct) {
    throw new Error('Source cash account not found.');
  }
  if (!toAcct) {
    throw new Error('Destination cash account not found.');
  }
  if (String(fromAcct.id) === String(toAcct.id)) {
    throw new Error('Cannot transfer to the same account.');
  }

  const amountFrom = Number(amount);
  if (!Number.isFinite(amountFrom) || amountFrom <= 0) {
    throw new Error('Transfer amount must be a positive number.');
  }

  let rate = fxRateOverride == null ? null : Number(fxRateOverride);
  if (rate != null && (!Number.isFinite(rate) || rate <= 0)) {
    throw new Error('Exchange rate override must be a positive number.');
  }

  if (rate == null) {
    const { rate: live } = await getCrossFxRate(fromAcct.currency, toAcct.currency);
    if (live == null || !Number.isFinite(live) || live <= 0) {
      throw new Error(
        'Could not load a live exchange rate for this currency pair. Enter a manual rate below.',
      );
    }
    rate = live;
  }

  const amountTo = roundMoney(amountFrom * rate, 8);

  await transferCashBetweenAccounts(userId, String(fromAcct.id), String(toAcct.id), amountFrom, amountTo);

  return {
    appliedRate: rate,
    amountDebited: amountFrom,
    amountCredited: amountTo,
    fromCurrency: String(fromAcct.currency || '').toUpperCase(),
    toCurrency: String(toAcct.currency || '').toUpperCase(),
  };
}
