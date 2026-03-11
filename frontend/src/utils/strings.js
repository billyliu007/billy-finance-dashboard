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

/**
 * Sanitize input for a decimal number (iOS-friendly: use with type="text" inputMode="decimal").
 * @param {string} value - Raw input value
 * @param {{ allowNegative?: boolean }} [options] - If true, allow one leading minus
 * @returns {string} - Sanitized string (digits, at most one '.', optional leading '-')
 */
export function sanitizeDecimalInput(value, options = {}) {
  const allowNegative = options.allowNegative === true;
  if (value === '' || (allowNegative && value === '-')) return value;
  let raw = String(value).replace(/[^\d.-]/g, '');
  if (!allowNegative && raw.includes('-')) raw = raw.replace(/-/g, '');
  if (allowNegative && raw.indexOf('-') > 0) raw = raw.replace(/-/g, '');
  return raw.replace(/^([^.]*\.)(.*)$/, (_, a, b) => a + (b.replace(/\./g, '') || ''));
}
