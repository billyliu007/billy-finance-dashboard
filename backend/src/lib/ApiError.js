/**
 * API error with HTTP status code. Handlers can pass to next(err);
 * the global error handler uses err.statusCode and getErrorMessage(err).
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode=500]
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}
