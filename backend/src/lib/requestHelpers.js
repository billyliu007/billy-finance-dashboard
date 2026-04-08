/**
 * Shared request/response helpers for Express handlers.
 */

const GOOGLE_OAUTH_CALLBACK_PATH = '/api/auth/google/callback';
const DEFAULT_VITE_PORT = '5173';

function parseHostAndPort(hostHeader) {
  if (!hostHeader) {
    return { host: '', port: null };
  }
  const h = String(hostHeader).trim();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end === -1) {
      return { host: h, port: null };
    }
    const hostname = h.slice(0, end + 1);
    const rest = h.slice(end + 1);
    if (rest.startsWith(':')) {
      const p = rest.slice(1);
      return { host: hostname, port: /^\d+$/.test(p) ? p : null };
    }
    return { host: hostname, port: null };
  }
  const idx = h.lastIndexOf(':');
  if (idx === -1) {
    return { host: h, port: null };
  }
  const maybePort = h.slice(idx + 1);
  if (!/^\d+$/.test(maybePort)) {
    return { host: h, port: null };
  }
  return { host: h.slice(0, idx), port: maybePort };
}

function isLocalDevHostname(host) {
  const bare = String(host || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (bare === 'localhost' || bare === '127.0.0.1' || bare === '::1') {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(bare)) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(bare)) {
    return true;
  }
  return false;
}

/**
 * Protocol for building public URLs (OAuth redirect_uri, frontend redirects).
 * @param {import('express').Request} req
 * @returns {string}
 */
export function getRequestPublicProto(req) {
  const xf = req?.headers?.['x-forwarded-proto']?.split(',')[0]?.trim();
  if (xf) {
    return xf.replace(/:$/, '');
  }
  if (req?.secure) {
    return 'https';
  }
  return 'http';
}

/**
 * Host header value for the backend as seen by the browser (for Google OAuth redirect_uri).
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function getOAuthBackendHostHeader(req) {
  if (!req) {
    return null;
  }
  const backendPort = String(process.env.PORT || 4000);
  const vitePort = String(process.env.FRONTEND_DEV_PORT || DEFAULT_VITE_PORT);
  const forwarded = req.headers['x-forwarded-host']?.split(',')[0]?.trim();

  if (forwarded) {
    const { host, port } = parseHostAndPort(forwarded);
    if (!host) {
      return null;
    }
    if (port === vitePort || port === null) {
      return `${host}:${backendPort}`;
    }
    return port ? `${host}:${port}` : `${host}:${backendPort}`;
  }

  const raw = req.headers.host?.trim();
  return raw || null;
}

/**
 * Full Google OAuth redirect_uri for this request (must match token exchange).
 * Falls back to GOOGLE_OAUTH_CALLBACK_URL when the host cannot be determined.
 * @param {import('express').Request|null} req
 * @returns {string}
 */
export function getGoogleOAuthRedirectUri(req) {
  const fallback = process.env.GOOGLE_OAUTH_CALLBACK_URL?.trim();
  if (!req) {
    if (!fallback) {
      throw new Error('Google OAuth callback URL is not configured.');
    }
    return fallback;
  }
  const hostHeader = getOAuthBackendHostHeader(req);
  if (!hostHeader) {
    if (!fallback) {
      throw new Error('Google OAuth callback URL is not configured.');
    }
    return fallback;
  }
  const proto = getRequestPublicProto(req);
  return `${proto}://${hostHeader}${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

/**
 * Base URL for browser redirects after OAuth (login error or success).
 * @param {import('express').Request|null} req
 * @returns {string}
 */
export function getFrontendRedirectBase(req) {
  const envUrl = process.env.FRONTEND_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  if (!req) {
    return 'http://localhost:5173';
  }
  const proto = getRequestPublicProto(req);
  const forwarded = req.headers['x-forwarded-host']?.split(',')[0]?.trim();
  if (forwarded) {
    return `${proto}://${forwarded}`.replace(/\/+$/, '');
  }

  const raw = req.headers.host?.trim();
  if (!raw) {
    return 'http://localhost:5173';
  }
  const backendPort = String(process.env.PORT || 4000);
  const vitePort = String(process.env.FRONTEND_DEV_PORT || DEFAULT_VITE_PORT);
  const { host, port } = parseHostAndPort(raw);
  if (port === backendPort && isLocalDevHostname(host)) {
    return `${proto}://${host}:${vitePort}`;
  }
  if (!isLocalDevHostname(host)) {
    return `${proto}://${raw}`.replace(/\/+$/, '');
  }
  return 'http://localhost:5173';
}

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
 * @param {import('express').Request|null} [req=null] - Used to infer frontend origin in local dev (e.g. LAN IP).
 */
export function redirectToFrontend(res, path, message = null, req = null) {
  const params = new URLSearchParams();
  if (message) {
    params.set('message', message);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  res.redirect(`${getFrontendRedirectBase(req)}${path}${suffix}`);
}

export function getFrontendBaseUrl() {
  return getFrontendRedirectBase(null);
}
