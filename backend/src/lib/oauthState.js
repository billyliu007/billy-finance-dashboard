import { randomBytes, timingSafeEqual } from 'node:crypto';
import { serialize } from 'cookie';

/**
 * OAuth `state` CSRF protection.
 *
 * On /start we generate a random state, send it to the provider, and also store it in a
 * short-lived httpOnly cookie on the backend origin. On /callback the provider echoes the
 * state back; it must match the cookie, proving this browser started the sign-in.
 */
const STATE_TTL_SECONDS = 10 * 60;
const COOKIE_PATH = '/api/auth';

export function oauthStateCookieName(provider) {
  return `bf_oauth_state_${provider}`;
}

export function generateOAuthState() {
  return randomBytes(32).toString('hex');
}

/**
 * @param {string} provider
 * @param {string} state
 * @param {{ secure: boolean, sameSite: 'lax' | 'none' }} security
 */
export function buildOAuthStateCookie(provider, state, security) {
  return serialize(oauthStateCookieName(provider), state, {
    httpOnly: true,
    secure: security.secure,
    sameSite: security.sameSite,
    path: COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS,
  });
}

export function clearOAuthStateCookie(provider, security) {
  return serialize(oauthStateCookieName(provider), '', {
    httpOnly: true,
    secure: security.secure,
    sameSite: security.sameSite,
    path: COOKIE_PATH,
    maxAge: 0,
  });
}

function readCookie(headerValue, name) {
  for (const part of String(headerValue || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

/**
 * True only when the callback's state equals the state stored for this provider.
 * @param {string|undefined} cookieHeader - req.headers.cookie
 * @param {string} provider
 * @param {unknown} returnedState - state echoed back by the provider
 */
export function isOAuthStateValid(cookieHeader, provider, returnedState) {
  const expected = readCookie(cookieHeader, oauthStateCookieName(provider));
  const actual = typeof returnedState === 'string' ? returnedState : '';
  if (!expected || !actual) {
    return false;
  }
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
