/**
 * Shared helpers for classifying and resolving asset/position data.
 */

/**
 * @param {object} asset - Position or asset with category
 * @returns {boolean}
 */
export function isStockAsset(asset) {
  return /stock/i.test(String(asset?.category || ''));
}

/**
 * @param {object} asset - Position or asset with category
 * @returns {boolean}
 */
export function isCryptoAsset(asset) {
  return /crypto/i.test(String(asset?.category || ''));
}
