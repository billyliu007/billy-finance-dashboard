/**
 * A recurring buy is a single BUY transaction holding a plan's running totals.
 * Updating it overwrites the totals instead of adding a transaction.
 */
const SCALE = 1e8; // portfolio_position_transactions stores 8 decimals
const round8 = (n) => Math.round(n * SCALE) / SCALE;

function positiveNumber(value, label) {
  const n = value === null || value === undefined || value === '' || typeof value === 'boolean' ? NaN : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be greater than 0.`);
  return n;
}

/** Validate input and derive the stored quantity and average cost. */
export function parseRecurringBuyInput(body = {}) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('Name is required.');
  if (name.length > 100) throw new Error('Name must be 100 characters or fewer.');

  const txDate = String(body.txDate ?? '').trim();
  const parsed = new Date(`${txDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(txDate)
    || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== txDate
  ) {
    throw new Error('Start date must be YYYY-MM-DD.');
  }

  const totalInvested = positiveNumber(body.totalInvested, 'Total invested');
  const qty = round8(positiveNumber(body.totalQty, 'Total quantity'));
  if (qty <= 0) throw new Error('Total quantity must be at least 0.00000001.');

  return {
    name,
    txDate,
    qty,
    avgCostPerUnit: round8(totalInvested / qty),
    totalInvested,
    cashId: body.cashId ? String(body.cashId).trim() : null,
  };
}

/** Cash movement for going from oldInvested to newInvested (negative = money leaves cash). */
export function recurringBuyCashDelta(oldInvested, newInvested) {
  return round8(Number(oldInvested || 0) - Number(newInvested || 0));
}
