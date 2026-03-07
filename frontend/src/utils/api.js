import { API_BASE_URL } from '../constants.js';

const DEFAULT_ERROR_MESSAGE = 'Could not load sheet data. Verify backend and Google Sheet settings.';

export function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}

export async function fetchJson(path, { signal, params } = {}) {
  const query = params ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}${path}${query}`, { signal });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (body?.message && typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return response.json();
}

export function getSheetLoadErrorMessage() {
  return DEFAULT_ERROR_MESSAGE;
}
