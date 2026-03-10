const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Fetch with timeout. Aborts the request after timeoutMs, rejecting with an error.
 * @param {string | URL} url
 * @param {{ timeoutMs?: number }} [options]
 */
export async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const e = new Error(`Request timed out after ${timeoutMs}ms`);
      e.cause = err;
      throw e;
    }
    throw err;
  }
}
