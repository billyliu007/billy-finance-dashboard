import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPasskeyChallengeCookie,
  clearPasskeyChallengeCookie,
  defaultPasskeyName,
  getPasskeyConfig,
  readPasskeyChallenge,
} from '../src/lib/passkeyConfig.js';
import { MAX_PASSKEYS_PER_USER, createPasskeyService } from '../src/services/passkeyService.js';

// --- config ---------------------------------------------------------------------------------

test('config defaults to the local Vite origin and localhost RP ID', () => {
  assert.deepEqual(getPasskeyConfig({}), {
    rpID: 'localhost',
    rpName: 'My Worth Track',
    origins: ['http://localhost:5173'],
  });
});

test('production: RP ID is the parent domain, origin comes from FRONTEND_BASE_URL', () => {
  const config = getPasskeyConfig({
    FRONTEND_BASE_URL: 'https://app.myworthtrack.com/',
    WEBAUTHN_RP_ID: 'myworthtrack.com',
  });
  assert.equal(config.rpID, 'myworthtrack.com');
  assert.deepEqual(config.origins, ['https://app.myworthtrack.com']);
});

test('explicit WEBAUTHN_ORIGINS wins and is de-duplicated', () => {
  const config = getPasskeyConfig({
    WEBAUTHN_ORIGINS: 'https://app.myworthtrack.com, https://app.myworthtrack.com/x, junk',
    WEBAUTHN_RP_ID: 'MyWorthTrack.com',
    FRONTEND_BASE_URL: 'http://localhost:5173',
  });
  assert.equal(config.rpID, 'myworthtrack.com');
  assert.deepEqual(config.origins, ['https://app.myworthtrack.com']);
});

test('mismatched RP ID and origin disables passkeys', () => {
  assert.equal(getPasskeyConfig({ FRONTEND_BASE_URL: 'https://app.example.org', WEBAUTHN_RP_ID: 'myworthtrack.com' }), null);
  // a lookalike suffix must not match
  assert.equal(getPasskeyConfig({ FRONTEND_BASE_URL: 'https://evilmyworthtrack.com', WEBAUTHN_RP_ID: 'myworthtrack.com' }), null);
});

test('challenge cookie round-trips per purpose', () => {
  const sec = { secure: true, sameSite: 'none' };
  const set = buildPasskeyChallengeCookie('login', 'abc_DEF-123', sec);
  assert.match(set, /^bf_passkey_challenge_login=abc_DEF-123/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=None/);
  assert.match(set, /Path=\/api\/auth\/passkey/);
  assert.match(set, /Max-Age=300/);
  const header = 'bf_session=x; bf_passkey_challenge_login=abc_DEF-123';
  assert.equal(readPasskeyChallenge(header, 'login'), 'abc_DEF-123');
  assert.equal(readPasskeyChallenge(header, 'register'), null);
  assert.equal(readPasskeyChallenge(undefined, 'login'), null);
  assert.match(clearPasskeyChallengeCookie('login', sec), /Max-Age=0/);
});

test('defaultPasskeyName from user agent', () => {
  assert.equal(defaultPasskeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), 'Passkey on Mac');
  assert.equal(defaultPasskeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'Passkey on iPhone');
  assert.equal(defaultPasskeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Passkey on Windows');
  assert.equal(defaultPasskeyName('Mozilla/5.0 (Linux; Android 15)'), 'Passkey on Android');
  assert.equal(defaultPasskeyName(''), 'Passkey');
});

// --- service (fake repo + fake WebAuthn library) --------------------------------------------

const CONFIG = { rpID: 'localhost', rpName: 'My Worth Track', origins: ['http://localhost:5173'] };
const USER = { userId: '11111111-1111-4111-8111-111111111111', email: 'b@example.com', displayName: 'B' };

function makeHarness({ verified = true, throws = null, existing = [] } = {}) {
  const rows = existing.map((r) => ({ ...r }));
  const sessions = [];
  const calls = {};
  let nextId = 1;
  const repo = {
    async listPasskeysForUser(userId) {
      return rows.filter((r) => r.userId === userId);
    },
    async findPasskeyByCredentialId(credentialId) {
      return rows.find((r) => r.credentialId === credentialId) || null;
    },
    async insertPasskey(input) {
      const row = { id: `pk-${nextId++}`, createdAt: 'now', lastUsedAt: null, ...input };
      rows.push(row);
      return row;
    },
    async updatePasskeyUsage(id, { counter, backedUp }) {
      Object.assign(rows.find((r) => r.id === id), { counter, backedUp, lastUsedAt: 'later' });
    },
    async deletePasskeyForUser(userId, id) {
      const i = rows.findIndex((r) => r.id === id && r.userId === userId);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
  };
  const webauthn = {
    async generateRegistrationOptions(opts) {
      calls.registration = opts;
      return { challenge: 'reg-challenge', rp: { id: opts.rpID } };
    },
    async verifyRegistrationResponse(opts) {
      calls.verifyRegistration = opts;
      if (throws) throw new Error(throws);
      if (!verified) return { verified: false };
      return {
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-NEW', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      };
    },
    async generateAuthenticationOptions(opts) {
      calls.authentication = opts;
      return { challenge: 'login-challenge' };
    },
    async verifyAuthenticationResponse(opts) {
      calls.verifyAuthentication = opts;
      if (throws) throw new Error(throws);
      return { verified, authenticationInfo: { newCounter: 7, credentialBackedUp: true } };
    },
  };
  const service = createPasskeyService({
    repo,
    webauthn,
    getConfig: () => CONFIG,
    createSession: async (userId) => {
      sessions.push(userId);
      return `session-for-${userId}`;
    },
  });
  return { service, rows, sessions, calls };
}

test('registration: options exclude existing passkeys and require a discoverable key', async () => {
  const h = makeHarness({ existing: [{ id: 'pk-a', userId: USER.userId, credentialId: 'cred-A', transports: ['usb'] }] });
  const { options, challenge } = await h.service.registrationOptions(USER);
  assert.equal(challenge, 'reg-challenge');
  assert.equal(options.rp.id, 'localhost');
  assert.deepEqual(h.calls.registration.excludeCredentials, [{ id: 'cred-A', transports: ['usb'] }]);
  assert.equal(h.calls.registration.authenticatorSelection.residentKey, 'required');
  assert.equal(h.calls.registration.userName, 'b@example.com');
  assert.equal(new TextDecoder().decode(h.calls.registration.userID), USER.userId);
});

test('registration verify saves the public key (base64url) and returns a summary without key material', async () => {
  const h = makeHarness();
  const summary = await h.service.verifyRegistration({
    user: USER,
    response: { id: 'cred-NEW' },
    expectedChallenge: 'reg-challenge',
    name: '  My Mac  ',
  });
  assert.deepEqual(summary, { id: 'pk-1', name: 'My Mac', createdAt: 'now', lastUsedAt: null, synced: true });
  assert.equal(h.rows[0].publicKey, Buffer.from([1, 2, 3]).toString('base64url'));
  assert.equal(h.rows[0].userId, USER.userId);
  assert.deepEqual(h.calls.verifyRegistration.expectedOrigin, ['http://localhost:5173']);
  assert.equal(h.calls.verifyRegistration.expectedRPID, 'localhost');
  assert.equal(h.calls.verifyRegistration.expectedChallenge, 'reg-challenge');
});

test('registration rejects missing challenge, failed verification, duplicates, demo and over-limit', async () => {
  await assert.rejects(
    makeHarness().service.verifyRegistration({ user: USER, response: {}, expectedChallenge: null }),
    { code: 'challenge_expired' },
  );
  await assert.rejects(
    makeHarness({ verified: false }).service.verifyRegistration({ user: USER, response: {}, expectedChallenge: 'c' }),
    { code: 'passkey_failed' },
  );
  await assert.rejects(
    makeHarness({ throws: 'Unexpected origin' }).service.verifyRegistration({ user: USER, response: {}, expectedChallenge: 'c' }),
    { code: 'passkey_failed', message: /Unexpected origin/ },
  );
  const dup = makeHarness({ existing: [{ id: 'pk-x', userId: 'someone-else', credentialId: 'cred-NEW' }] });
  await assert.rejects(dup.service.verifyRegistration({ user: USER, response: {}, expectedChallenge: 'c' }), {
    code: 'passkey_exists',
    statusCode: 409,
  });
  await assert.rejects(makeHarness().service.registrationOptions({ ...USER, email: 'demo@myworthtrack.local' }), {
    code: 'demo_not_allowed',
    statusCode: 403,
  });
  const full = makeHarness({
    existing: Array.from({ length: MAX_PASSKEYS_PER_USER }, (_, i) => ({ id: `p${i}`, userId: USER.userId, credentialId: `c${i}` })),
  });
  await assert.rejects(full.service.registrationOptions(USER), { code: 'passkey_limit' });
});

test('sign-in: discoverable options, then verify against the stored key and create a session', async () => {
  const h = makeHarness({
    existing: [{
      id: 'pk-a', userId: USER.userId, credentialId: 'cred-A',
      publicKey: Buffer.from([9, 8, 7]).toString('base64url'), counter: 3, transports: ['internal'], backedUp: false,
    }],
  });
  const { challenge } = await h.service.authenticationOptions();
  assert.equal(challenge, 'login-challenge');
  assert.deepEqual(h.calls.authentication.allowCredentials, []);

  const out = await h.service.verifyAuthentication({ response: { id: 'cred-A' }, expectedChallenge: 'login-challenge' });
  assert.deepEqual(out, { userId: USER.userId, sessionToken: `session-for-${USER.userId}` });
  const cred = h.calls.verifyAuthentication.credential;
  assert.equal(cred.id, 'cred-A');
  assert.deepEqual([...cred.publicKey], [9, 8, 7]);
  assert.equal(cred.counter, 3);
  assert.equal(h.rows[0].counter, 7, 'counter updated');
  assert.equal(h.rows[0].lastUsedAt, 'later');
});

test('sign-in rejects unknown passkeys, failed signatures and missing challenges without a session', async () => {
  const existing = [{ id: 'pk-a', userId: USER.userId, credentialId: 'cred-A', publicKey: 'AQ', counter: 0, transports: [] }];
  const unknown = makeHarness({ existing });
  await assert.rejects(unknown.service.verifyAuthentication({ response: { id: 'cred-ZZZ' }, expectedChallenge: 'c' }), {
    code: 'passkey_not_found',
  });
  const bad = makeHarness({ existing, verified: false });
  await assert.rejects(bad.service.verifyAuthentication({ response: { id: 'cred-A' }, expectedChallenge: 'c' }), {
    code: 'passkey_failed',
  });
  const noChallenge = makeHarness({ existing });
  await assert.rejects(noChallenge.service.verifyAuthentication({ response: { id: 'cred-A' }, expectedChallenge: null }), {
    code: 'challenge_expired',
  });
  assert.equal(unknown.sessions.length + bad.sessions.length + noChallenge.sessions.length, 0);
});

test('remove only deletes the signed-in user\'s own passkey', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const h = makeHarness({ existing: [{ id, userId: 'other-user', credentialId: 'c' }] });
  await assert.rejects(h.service.removeForUser(USER, id), { statusCode: 404 });
  await assert.rejects(h.service.removeForUser(USER, 'not-a-uuid'), { statusCode: 404 });
  assert.equal(h.rows.length, 1);
  const own = makeHarness({ existing: [{ id, userId: USER.userId, credentialId: 'c' }] });
  assert.deepEqual(await own.service.removeForUser(USER, id), { ok: true });
  assert.equal(own.rows.length, 0);
});
