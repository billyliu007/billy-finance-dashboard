/**
 * Validation and normalization of onboarding request payload.
 */

const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 30;

/**
 * Normalize and validate onboarding request body.
 * Cash components: currency, name, balance (negative = debt).
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
    const name = String(item?.name ?? item?.displayName ?? `Component ${index + 1}`).trim();
    const currency = String(item?.currency || 'CNY').trim().toUpperCase();
    const balance = Number(item?.balance ?? item?.amount ?? 0);
    if (!name || !currency || !Number.isFinite(balance)) {
      throw new Error('Invalid cash component: need currency, name, and balance (number).');
    }
    return { name, currency, balance };
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
