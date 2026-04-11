import { createHash, randomBytes } from 'node:crypto';
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

function buildCookieSecurityOptions() {
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

function makeStateToken(provider) {
  const raw = `${provider}:${Date.now()}:${randomBytes(16).toString('hex')}`;
  return createHash('sha256').update(raw).digest('hex');
}

export function buildGoogleAuthUrl(req) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('Google OAuth is not configured.');
  }
  const redirectUri = getGoogleOAuthRedirectUri(req || null);
  const state = makeStateToken('google');
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

export function buildAppleAuthUrl() {
  const clientId = process.env.APPLE_CLIENT_ID;
  const callbackUrl = process.env.APPLE_CALLBACK_URL;
  if (!clientId || !callbackUrl) {
    throw new Error('Apple OAuth is not configured.');
  }
  const state = makeStateToken('apple');
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
