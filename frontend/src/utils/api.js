import { API_BASE_URL } from '../constants.js';

const DEFAULT_ERROR_MESSAGE = 'Could not load data. Verify backend and authentication settings.';

export function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}

async function requestJson(path, { signal, params, method = 'GET', body } = {}) {
  const query = params ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}${path}${query}`, {
    signal,
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

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

  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export async function fetchJson(path, { signal, params } = {}) {
  return requestJson(path, { signal, params });
}

export async function postJson(path, body, { signal } = {}) {
  return requestJson(path, { signal, method: 'POST', body });
}

export function getSheetLoadErrorMessage() {
  return DEFAULT_ERROR_MESSAGE;
}
