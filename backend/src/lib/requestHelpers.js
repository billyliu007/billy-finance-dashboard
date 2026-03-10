/**
 * Shared request/response helpers for Express handlers.
 */

/**
 * Derive a user-facing error message from an error (including axios-style response).
 * @param {unknown} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  const data = error?.response?.data;
  if (data?.error?.message) return data.error.message;
  if (data?.message && typeof data.message === 'string') return data.message;
  if (error?.message) return String(error.message);
  return 'Request failed.';
}

/**
 * Redirect to the frontend with an optional query message.
 * @param {import('express').Response} res
 * @param {string} path - Frontend path (e.g. '/login')
 * @param {string|null} [message=null]
 */
export function redirectToFrontend(res, path, message = null) {
  const params = new URLSearchParams();
  if (message) {
    params.set('message', message);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  res.redirect(`${getFrontendBaseUrl()}${path}${suffix}`);
}

export function getFrontendBaseUrl() {
  return String(process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}
