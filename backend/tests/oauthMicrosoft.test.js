import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOAuthStateCookie,
  clearOAuthStateCookie,
  generateOAuthState,
  isOAuthStateValid,
  oauthStateCookieName,
} from '../src/lib/oauthState.js';
import {
  MICROSOFT_CONSUMER_TENANT_ID,
  buildMicrosoftAuthUrl,
  isMicrosoftLoginConfigured,
  parseMicrosoftIdTokenClaims,
} from '../src/services/authService.js';

const LAX = { secure: false, sameSite: 'lax' };

test('OAuth state cookie round-trips and is provider-specific', () => {
  const state = generateOAuthState();
  assert.match(state, /^[0-9a-f]{64}$/);
  assert.notEqual(generateOAuthState(), state);

  const setCookie = buildOAuthStateCookie('microsoft', state, LAX);
  assert.match(setCookie, /^bf_oauth_state_microsoft=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Path=\/api\/auth/);
  assert.match(setCookie, /Max-Age=600/);

  const cookieHeader = `bf_session=abc; ${oauthStateCookieName('microsoft')}=${state}`;
  assert.equal(isOAuthStateValid(cookieHeader, 'microsoft', state), true);
  assert.equal(isOAuthStateValid(cookieHeader, 'google', state), false, 'other provider has no cookie');
  assert.equal(isOAuthStateValid(cookieHeader, 'microsoft', generateOAuthState()), false);
  assert.equal(isOAuthStateValid(cookieHeader, 'microsoft', undefined), false);
  assert.equal(isOAuthStateValid(undefined, 'microsoft', state), false);
  assert.equal(isOAuthStateValid(cookieHeader, 'microsoft', state.slice(0, 10)), false);

  assert.match(clearOAuthStateCookie('microsoft', LAX), /Max-Age=0/);
});

test('OAuth state cookie uses SameSite=None; Secure in production mode', () => {
  const cookie = buildOAuthStateCookie('apple', 'x', { secure: true, sameSite: 'none' });
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=None/);
});

function withMicrosoftEnv(t, values) {
  const keys = ['MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'MICROSOFT_OAUTH_CALLBACK_URL'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
  for (const k of keys) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
}

test('Microsoft is only enabled when all three settings are present', (t) => {
  withMicrosoftEnv(t, { MICROSOFT_OAUTH_CLIENT_ID: 'id', MICROSOFT_OAUTH_CLIENT_SECRET: '' });
  assert.equal(isMicrosoftLoginConfigured(), false);
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'secret';
  process.env.MICROSOFT_OAUTH_CALLBACK_URL = 'http://localhost:4000/api/auth/microsoft/callback';
  assert.equal(isMicrosoftLoginConfigured(), true);
});

test('buildMicrosoftAuthUrl targets the consumers endpoint and carries state', (t) => {
  withMicrosoftEnv(t, {
    MICROSOFT_OAUTH_CLIENT_ID: 'client-123',
    MICROSOFT_OAUTH_CLIENT_SECRET: 'secret',
    MICROSOFT_OAUTH_CALLBACK_URL: 'http://localhost:4000/api/auth/microsoft/callback',
  });
  const url = new URL(buildMicrosoftAuthUrl('state-abc'));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:4000/api/auth/microsoft/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('state'), 'state-abc');
});

test('buildMicrosoftAuthUrl throws when not configured', (t) => {
  withMicrosoftEnv(t, {});
  assert.throws(() => buildMicrosoftAuthUrl('s'), /not configured/);
});

const NOW = Date.parse('2026-11-18T00:00:00Z');
const goodClaims = () => ({
  aud: 'client-123',
  iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT_ID}/v2.0`,
  tid: MICROSOFT_CONSUMER_TENANT_ID,
  sub: 'AAAAsub',
  exp: Math.floor(NOW / 1000) + 3600,
  email: 'Billy@Outlook.com',
  name: 'Billy',
});
const parse = (claims) => parseMicrosoftIdTokenClaims(claims, { clientId: 'client-123', nowMs: NOW });

test('valid personal-account claims are accepted and email is normalized', () => {
  assert.deepEqual(parse(goodClaims()), {
    providerUserId: 'AAAAsub',
    email: 'billy@outlook.com',
    displayName: 'Billy',
  });
});

test('falls back to preferred_username when email claim is absent', () => {
  const claims = { ...goodClaims(), email: undefined, preferred_username: 'me@hotmail.com', name: '' };
  assert.deepEqual(parse(claims), { providerUserId: 'AAAAsub', email: 'me@hotmail.com', displayName: null });
});

test('rejects work/school tenants, wrong audience, expiry, missing sub or email', () => {
  assert.throws(() => parse({ ...goodClaims(), tid: '11111111-2222-3333-4444-555555555555' }), /personal Microsoft accounts/);
  assert.throws(
    () => parse({ ...goodClaims(), iss: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0' }),
    /personal Microsoft accounts/,
  );
  assert.throws(() => parse({ ...goodClaims(), aud: 'someone-else' }), /audience/);
  assert.throws(() => parse({ ...goodClaims(), exp: Math.floor(NOW / 1000) - 1 }), /expired/);
  assert.throws(() => parse({ ...goodClaims(), sub: '' }), /subject/);
  assert.throws(
    () => parse({ ...goodClaims(), email: undefined, preferred_username: '+15551234567' }),
    /no email address/,
  );
  assert.throws(() => parse(null), /unreadable/);
});
