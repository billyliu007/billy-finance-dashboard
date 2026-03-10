/**
 * Validation and normalization of onboarding request payload.
 */

const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 30;
const CASH_TYPES = ['asset', 'liability'];

/**
 * Normalize and validate onboarding request body.
 * @param {object} body - Raw request body
 * @returns {{ displayName: string, cashComponents: object[], positions: object[] }}
 * @throws {Error} When validation fails
 */
export function parseOnboardingPayload(body) {
  const displayName = String(body?.displayName || '').trim();
  const cashComponents = Array.isArray(body?.cashComponents) ? body.cashComponents : [];
  const positions = Array.isArray(body?.positions) ? body.positions : [];

  if (!displayName || displayName.length < DISPLAY_NAME_MIN || displayName.length > DISPLAY_NAME_MAX) {
    throw new Error('Display name must be between 2 and 30 characters.');
  }
  if (cashComponents.length === 0) {
    throw new Error('At least one cash/debt component is required.');
  }
  if (positions.length === 0) {
    throw new Error('At least one asset position is required.');
  }

  const normalizedCash = cashComponents.map((item, index) => {
    const key = String(item?.key || `component_${index + 1}`).trim().toLowerCase();
    const name = String(item?.name || key).trim();
    const currency = String(item?.currency || 'CNY').trim().toUpperCase();
    const type = String(item?.type || 'asset').trim().toLowerCase();
    const amount = Number(item?.amount || 0);
    if (!key || !name || !currency || !CASH_TYPES.includes(type) || !Number.isFinite(amount)) {
      throw new Error('Invalid cash/debt input.');
    }
    return {
      key,
      name,
      currency,
      type,
      category: String(item?.category || 'Cash'),
      amount,
    };
  });

  const normalizedPositions = positions.map((item) => {
    const symbol = String(item?.symbol || '').trim().toUpperCase();
    const category = String(item?.category || '').trim();
    const qty = Number(item?.qty || 0);
    const purchasePrice = Number(item?.purchasePrice || 0);
    if (!symbol || !category || !Number.isFinite(qty) || !Number.isFinite(purchasePrice)) {
      throw new Error('Invalid asset input.');
    }
    return {
      symbol,
      category,
      qty,
      purchasePrice,
      marketProvider: item?.marketProvider ?? null,
      marketInstrumentId: item?.marketInstrumentId ?? null,
    };
  });

  return {
    displayName,
    cashComponents: normalizedCash,
    positions: normalizedPositions,
  };
}
