/**
 * String normalization helpers.
 */

/**
 * Trim and coerce value to a non-null string.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeText(value) {
  return String(value ?? '').trim();
}
