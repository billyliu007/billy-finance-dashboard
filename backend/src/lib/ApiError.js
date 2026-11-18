/**
 * API error with HTTP status code. Handlers can pass to next(err);
 * the global error handler uses err.statusCode and getErrorMessage(err).
 * Optional `code` (machine-readable, e.g. for i18n on the client) and `details`
 * are serialized alongside `message` when present.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode=500]
   * @param {{ code?: string, details?: Record<string, unknown> }} [extra]
   */
  constructor(message, statusCode = 500, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    if (code) {
      this.code = code;
    }
    if (details) {
      this.details = details;
    }
  }
}
