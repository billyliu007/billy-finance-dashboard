import { serialize } from 'cookie';

/**
 * Passkey (WebAuthn) configuration.
 *
 * - Origins: the frontend URL(s) where the browser runs the passkey prompt
 *   (WEBAUTHN_ORIGINS, comma-separated; defaults to FRONTEND_BASE_URL, then local Vite).
 * - RP ID: the domain passkeys are bound to (WEBAUTHN_RP_ID; defaults to the first origin's
 *   hostname). Must equal, or be a parent domain of, every origin's hostname. Changing it
 *   later makes existing passkeys unusable, so production pins it to `myworthtrack.com`.
 */
export const PASSKEY_RP_NAME = 'My Worth Track';
const DEFAULT_LOCAL_ORIGIN = 'http://localhost:5173';

function parseOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hostnameMatchesRpId(hostname, rpId) {
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ rpID: string, rpName: string, origins: string[] } | null} null when misconfigured
 */
export function getPasskeyConfig(env = process.env) {
  const configured = String(env.WEBAUTHN_ORIGINS || '')
    .split(',')
    .map(parseOrigin)
    .filter(Boolean);
  const fallback = parseOrigin(env.FRONTEND_BASE_URL || '') || DEFAULT_LOCAL_ORIGIN;
  const origins = configured.length > 0 ? [...new Set(configured)] : [fallback];

  const rpID = String(env.WEBAUTHN_RP_ID || '').trim().toLowerCase() || new URL(origins[0]).hostname;
  const allMatch = origins.every((origin) => hostnameMatchesRpId(new URL(origin).hostname, rpID));
  if (!rpID || !allMatch) {
    return null;
  }
  return { rpID, rpName: PASSKEY_RP_NAME, origins };
}

// --- Challenge cookie --------------------------------------------------------------------
// Each ceremony gets a fresh server-generated challenge, kept in a short-lived httpOnly
// cookie and cleared once used, so a response can only be verified against the challenge
// this browser was just given.

const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_COOKIE_PATH = '/api/auth/passkey';

export function passkeyChallengeCookieName(purpose) {
  return `bf_passkey_challenge_${purpose}`;
}

export function buildPasskeyChallengeCookie(purpose, challenge, security) {
  return serialize(passkeyChallengeCookieName(purpose), challenge, {
    httpOnly: true,
    secure: security.secure,
    sameSite: security.sameSite,
    path: CHALLENGE_COOKIE_PATH,
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

export function clearPasskeyChallengeCookie(purpose, security) {
  return serialize(passkeyChallengeCookieName(purpose), '', {
    httpOnly: true,
    secure: security.secure,
    sameSite: security.sameSite,
    path: CHALLENGE_COOKIE_PATH,
    maxAge: 0,
  });
}

export function readPasskeyChallenge(cookieHeader, purpose) {
  const name = passkeyChallengeCookieName(purpose);
  for (const part of String(cookieHeader || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      const value = rest.join('=');
      return value || null;
    }
  }
  return null;
}

/** "Passkey on Mac" etc. from the User-Agent, used when the user doesn't name the passkey. */
export function defaultPasskeyName(userAgent) {
  const ua = String(userAgent || '');
  const platform = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : '';
  return platform ? `Passkey on ${platform}` : 'Passkey';
}
