import { randomBytes } from 'node:crypto';
import { serialize } from 'cookie';
import {
  clearExpiredSessions,
  createSession,
  deleteSession,
  findIdentity,
  findOrCreateUserByGoogleEmail,
  findSession,
  findUserByEmail,
  upsertIdentity,
  createUser,
} from '../repositories/userRepository.js';
import { API_TOKEN_PREFIX, readBearerToken } from '../lib/apiTokenCrypto.js';
import { resolveUserFromApiTokenPlain } from '../repositories/apiTokenRepository.js';
import { getGoogleOAuthRedirectUri } from '../lib/requestHelpers.js';

const SESSION_COOKIE_NAME = 'bf_session';
const SESSION_TTL_MS = Number(process.env.AUTH_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 14);

function isProduction() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function isHostedHttpsFrontend() {
  const frontendBaseUrl = String(process.env.FRONTEND_BASE_URL || '').trim();
  if (!frontendBaseUrl) {
    return false;
  }
  try {
    const parsed = new URL(frontendBaseUrl);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

export function buildCookieSecurityOptions() {
  if (isProduction() || isHostedHttpsFrontend()) {
    // Frontend and backend run on different Render domains in production.
    // Cross-site XHR/fetch with credentials requires SameSite=None + Secure.
    return { secure: true, sameSite: 'none' };
  }
  return { secure: false, sameSite: 'lax' };
}

export function buildSessionCookie(sessionToken) {
  const security = buildCookieSecurityOptions();
  return serialize(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: security.secure,
    sameSite: security.sameSite,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie() {
  const security = buildCookieSecurityOptions();
  return serialize(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: security.secure,
    sameSite: security.sameSite,
    path: '/',
    maxAge: 0,
  });
}

export function readSessionTokenFromCookie(headerValue) {
  if (!headerValue) {
    return null;
  }
  const segments = String(headerValue)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const [key, ...rest] = segment.split('=');
    if (key === SESSION_COOKIE_NAME) {
      return rest.join('=');
    }
  }
  return null;
}

export async function createUserSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createSession(userId, token, expiresAt);
  return token;
}

const DEMO_EMAIL = 'demo@myworthtrack.local';

export async function resolveOrCreateDemoUser() {
  const existing = await findUserByEmail(DEMO_EMAIL);
  if (existing) {
    return existing;
  }
  const created = await createUser({
    email: DEMO_EMAIL,
    displayName: 'Demo User',
    onboardingCompleted: false,
  });
  return created;
}

function sessionRowToAuthUser(sessionRow) {
  return {
    userId: sessionRow.userId,
    email: sessionRow.email,
    displayName: sessionRow.displayName,
    publicId: sessionRow.publicId,
    onboardingCompleted: sessionRow.onboardingCompleted,
    baseCurrency: sessionRow.baseCurrency,
  };
}

export async function resolveSessionFromRequest(req) {
  await clearExpiredSessions();

  const cookieToken = readSessionTokenFromCookie(req.headers.cookie);
  if (cookieToken) {
    const session = await findSession(cookieToken);
    if (session) {
      const expiresMs = new Date(session.expiresAt).getTime();
      if (Number.isFinite(expiresMs) && expiresMs > Date.now()) {
        return { token: cookieToken, user: sessionRowToAuthUser(session) };
      }
      await deleteSession(cookieToken);
    }
  }

  const bearer = readBearerToken(req.headers.authorization);
  if (!bearer) {
    return null;
  }

  if (bearer.startsWith(API_TOKEN_PREFIX)) {
    const user = await resolveUserFromApiTokenPlain(bearer);
    if (!user) {
      return null;
    }
    const { apiTokenId, ...rest } = user;
    return { token: null, user: rest, apiTokenId };
  }

  const sessionFromBearer = await findSession(bearer);
  if (sessionFromBearer) {
    const expiresMs = new Date(sessionFromBearer.expiresAt).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      await deleteSession(bearer);
      return null;
    }
    return { token: bearer, user: sessionRowToAuthUser(sessionFromBearer) };
  }

  const patUser = await resolveUserFromApiTokenPlain(bearer);
  if (!patUser) {
    return null;
  }
  const { apiTokenId, ...rest } = patUser;
  return { token: null, user: rest, apiTokenId };
}

export function buildGoogleAuthUrl(req, state) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('Google OAuth is not configured.');
  }
  const redirectUri = getGoogleOAuthRedirectUri(req || null);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildAppleAuthUrl(state) {
  const clientId = process.env.APPLE_CLIENT_ID;
  const callbackUrl = process.env.APPLE_CALLBACK_URL;
  if (!clientId || !callbackUrl) {
    throw new Error('Apple OAuth is not configured.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state,
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

export async function completeGoogleLogin(code, redirectUri) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured.');
  }
  if (!redirectUri) {
    throw new Error('Google OAuth redirect URI is missing.');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) {
    const raw = await tokenResponse.text();
    let detail = '';
    try {
      const body = JSON.parse(raw);
      detail = body.error_description || body.error || '';
    } catch {
      // ignore
    }
    throw new Error(detail ? `Google token exchange failed: ${detail}` : 'Google token exchange failed.');
  }
  const tokenBody = await tokenResponse.json();
  const accessToken = tokenBody?.access_token;
  if (!accessToken) {
    throw new Error('Google access token missing.');
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResponse.ok) {
    throw new Error('Google profile fetch failed.');
  }
  const profile = await profileResponse.json();
  const providerUserId = String(profile?.id || '').trim();
  const email = String(profile?.email || '').trim();
  const emailVerified = profile?.verified_email === true;
  if (!providerUserId || !email || !emailVerified) {
    throw new Error('Google profile is missing required fields.');
  }

  const existingIdentity = await findIdentity('google', providerUserId);
  let user = null;
  if (existingIdentity) {
    user = await findOrCreateUserByGoogleEmail({ email, displayName: profile?.name || null });
  } else {
    const migrationBindEnabled = String(process.env.MIGRATION_BIND_ENABLED || '').toLowerCase() === 'true';
    if (migrationBindEnabled) {
      user = await findUserByEmail(email);
    }
    if (!user) {
      user = await findOrCreateUserByGoogleEmail({ email, displayName: profile?.name || null });
    }
  }

  await upsertIdentity({
    userId: user.id,
    provider: 'google',
    providerUserId,
    providerEmail: email,
    profile,
  });

  const sessionToken = await createUserSession(user.id);
  return { userId: user.id, sessionToken };
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) {
    return null;
  }
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  const raw = Buffer.from(padded, 'base64').toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function completeAppleLogin(code) {
  const clientId = process.env.APPLE_CLIENT_ID;
  const clientSecret = process.env.APPLE_CLIENT_SECRET;
  const callbackUrl = process.env.APPLE_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error('Apple OAuth is not configured.');
  }
  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error('Apple token exchange failed.');
  }
  const tokenBody = await tokenResponse.json();
  const claims = decodeJwtPayload(tokenBody?.id_token);
  const providerUserId = String(claims?.sub || '').trim();
  const email = claims?.email ? String(claims.email).trim() : null;
  if (!providerUserId) {
    throw new Error('Apple profile is missing subject identifier.');
  }

  const existingIdentity = await findIdentity('apple', providerUserId);
  let user = null;
  if (existingIdentity) {
    user = await findOrCreateUserByGoogleEmail({ email: email || `apple_${providerUserId}@local`, displayName: null });
  } else {
    user = await findOrCreateUserByGoogleEmail({ email: email || `apple_${providerUserId}@local`, displayName: null });
  }
  await upsertIdentity({
    userId: user.id,
    provider: 'apple',
    providerUserId,
    providerEmail: email,
    profile: claims || {},
  });
  const sessionToken = await createUserSession(user.id);
  return { userId: user.id, sessionToken };
}

// --- Microsoft (personal accounts only: Outlook, Hotmail, Live) ---------------------------

// Personal Microsoft accounts all live in this fixed "consumers" tenant.
export const MICROSOFT_CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MICROSOFT_ISSUER = `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT_ID}/v2.0`;

function getMicrosoftConfig() {
  const clientId = String(process.env.MICROSOFT_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.MICROSOFT_OAUTH_CLIENT_SECRET || '').trim();
  const callbackUrl = String(process.env.MICROSOFT_OAUTH_CALLBACK_URL || '').trim();
  return { clientId, clientSecret, callbackUrl };
}

export function isMicrosoftLoginConfigured() {
  const { clientId, clientSecret, callbackUrl } = getMicrosoftConfig();
  return Boolean(clientId && clientSecret && callbackUrl);
}

export function buildMicrosoftAuthUrl(state) {
  const { clientId, callbackUrl } = getMicrosoftConfig();
  if (!clientId || !callbackUrl) {
    throw new Error('Microsoft sign-in is not configured.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  return `${MICROSOFT_AUTHORITY}/authorize?${params.toString()}`;
}

/**
 * Validate the ID token claims we rely on. The token comes straight from Microsoft's token
 * endpoint over TLS (code flow), so we check claims rather than re-verifying the signature.
 * Only personal Microsoft accounts are accepted: their sign-in email is verified by Microsoft,
 * which makes it safe to link to an existing account with the same email.
 * @returns {{ providerUserId: string, email: string, displayName: string|null }}
 */
export function parseMicrosoftIdTokenClaims(claims, { clientId, nowMs = Date.now() }) {
  if (!claims || typeof claims !== 'object') {
    throw new Error('Microsoft sign-in returned an unreadable ID token.');
  }
  if (claims.aud !== clientId) {
    throw new Error('Microsoft ID token audience mismatch.');
  }
  if (claims.iss !== MICROSOFT_ISSUER || claims.tid !== MICROSOFT_CONSUMER_TENANT_ID) {
    throw new Error('Only personal Microsoft accounts (Outlook, Hotmail, Live) are supported.');
  }
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= nowMs) {
    throw new Error('Microsoft ID token has expired.');
  }
  const providerUserId = String(claims.sub || '').trim();
  if (!providerUserId) {
    throw new Error('Microsoft profile is missing a subject identifier.');
  }
  const candidates = [claims.email, claims.preferred_username];
  const email = candidates
    .map((v) => String(v || '').trim().toLowerCase())
    .find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  if (!email) {
    throw new Error('Your Microsoft account has no email address. Use Google sign-in instead.');
  }
  const displayName = String(claims.name || '').trim() || null;
  return { providerUserId, email, displayName };
}

export async function completeMicrosoftLogin(code) {
  const { clientId, clientSecret, callbackUrl } = getMicrosoftConfig();
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error('Microsoft sign-in is not configured.');
  }
  const tokenResponse = await fetch(`${MICROSOFT_AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
      scope: 'openid email profile',
    }),
  });
  if (!tokenResponse.ok) {
    let detail = '';
    try {
      const body = await tokenResponse.json();
      detail = body.error_description || body.error || '';
    } catch {
      // ignore
    }
    throw new Error(detail ? `Microsoft token exchange failed: ${detail}` : 'Microsoft token exchange failed.');
  }
  const tokenBody = await tokenResponse.json();
  const claims = decodeJwtPayload(tokenBody?.id_token);
  const { providerUserId, email, displayName } = parseMicrosoftIdTokenClaims(claims, { clientId });

  const user = await findOrCreateUserByGoogleEmail({ email, displayName });
  await upsertIdentity({
    userId: user.id,
    provider: 'microsoft',
    providerUserId,
    providerEmail: email,
    profile: { name: displayName, email, tid: claims.tid },
  });
  const sessionToken = await createUserSession(user.id);
  return { userId: user.id, sessionToken };
}
