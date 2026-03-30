export function computePositionTxCashDelta({ type, qty, pricePerUnit, feeFlat = 0 }) {
  const t = String(type || '').trim().toUpperCase();
  const q = Number(qty) || 0;
  const px = Number(pricePerUnit) || 0;
  const fee = Number(feeFlat) || 0;
  const gross = q * px;
  if (!Number.isFinite(gross) || !Number.isFinite(fee)) return 0;
  if (t === 'BUY') return -(gross + fee);
  if (t === 'SELL') return gross - fee;
  return 0;
}

export function computePositionTxCashReverseDelta(args) {
  return -computePositionTxCashDelta(args);
}

