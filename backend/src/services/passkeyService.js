import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { ApiError } from '../lib/ApiError.js';
import { getPasskeyConfig } from '../lib/passkeyConfig.js';
import * as passkeyRepo from '../repositories/passkeyRepository.js';

export const MAX_PASSKEYS_PER_USER = 10;
const DEMO_EMAIL = 'demo@myworthtrack.local';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultWebauthn = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

const toBase64Url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromBase64Url = (text) => new Uint8Array(Buffer.from(String(text || ''), 'base64url'));

/** Public shape returned to the browser (no key material). */
export function toPasskeySummary(row) {
  return {
    id: row.id,
    name: row.name || 'Passkey',
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
    synced: Boolean(row.backedUp),
  };
}

function requireConfig(getConfig) {
  const config = getConfig();
  if (!config) {
    throw new ApiError('Passkeys are not available on this server.', 503, { code: 'passkey_unavailable' });
  }
  return config;
}

function assertEligibleUser(user) {
  if (!user?.userId) {
    throw new ApiError('Authentication required.', 401);
  }
  if (String(user.email || '').toLowerCase() === DEMO_EMAIL) {
    throw new ApiError("Passkeys can't be added to the shared demo account.", 403, { code: 'demo_not_allowed' });
  }
}

/**
 * Factory so tests can inject fakes for persistence, the WebAuthn library and sessions.
 */
export function createPasskeyService({
  repo = passkeyRepo,
  webauthn = defaultWebauthn,
  getConfig = () => getPasskeyConfig(),
  createSession,
} = {}) {
  async function registrationOptions(user) {
    assertEligibleUser(user);
    const config = requireConfig(getConfig);
    const existing = await repo.listPasskeysForUser(user.userId);
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw new ApiError(`You can have up to ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.`, 400, {
        code: 'passkey_limit',
      });
    }
    const options = await webauthn.generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: new TextEncoder().encode(user.userId),
      userName: user.email || user.userId,
      userDisplayName: user.displayName || user.email || 'My Worth Track user',
      attestationType: 'none',
      // Don't register the same authenticator twice for this account.
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    return { options, challenge: options.challenge };
  }

  async function verifyRegistration({ user, response, expectedChallenge, name }) {
    assertEligibleUser(user);
    const config = requireConfig(getConfig);
    if (!expectedChallenge) {
      throw new ApiError('Passkey setup timed out. Try again.', 400, { code: 'challenge_expired' });
    }
    let verification;
    try {
      verification = await webauthn.verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpID,
        requireUserVerification: false,
      });
    } catch (error) {
      throw new ApiError(`Passkey couldn't be verified: ${error?.message || 'unknown error'}`, 400, {
        code: 'passkey_failed',
      });
    }
    if (!verification?.verified || !verification.registrationInfo) {
      throw new ApiError("Passkey couldn't be verified.", 400, { code: 'passkey_failed' });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const duplicate = await repo.findPasskeyByCredentialId(credential.id);
    if (duplicate) {
      throw new ApiError('This passkey is already registered.', 409, { code: 'passkey_exists' });
    }
    const saved = await repo.insertPasskey({
      userId: user.userId,
      credentialId: credential.id,
      publicKey: toBase64Url(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports || response?.response?.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: String(name || '').trim().slice(0, 60) || 'Passkey',
    });
    return toPasskeySummary(saved);
  }

  async function authenticationOptions() {
    const config = requireConfig(getConfig);
    // Empty allowCredentials = "discoverable" sign-in: the device offers its passkeys for
    // this site, so the user doesn't type an email first.
    const options = await webauthn.generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: [],
      userVerification: 'preferred',
    });
    return { options, challenge: options.challenge };
  }

  async function verifyAuthentication({ response, expectedChallenge }) {
    const config = requireConfig(getConfig);
    if (!expectedChallenge) {
      throw new ApiError('Sign-in timed out. Try again.', 400, { code: 'challenge_expired' });
    }
    const credentialId = String(response?.id || '');
    const stored = credentialId ? await repo.findPasskeyByCredentialId(credentialId) : null;
    if (!stored) {
      throw new ApiError(
        "This passkey isn't registered with My Worth Track. Sign in with Google or Microsoft, then add it in Settings.",
        400,
        { code: 'passkey_not_found' },
      );
    }
    let verification;
    try {
      verification = await webauthn.verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpID,
        credential: {
          id: stored.credentialId,
          publicKey: fromBase64Url(stored.publicKey),
          counter: stored.counter,
          transports: stored.transports,
        },
        requireUserVerification: false,
      });
    } catch (error) {
      throw new ApiError(`Passkey sign-in failed: ${error?.message || 'unknown error'}`, 400, {
        code: 'passkey_failed',
      });
    }
    if (!verification?.verified) {
      throw new ApiError('Passkey sign-in failed.', 400, { code: 'passkey_failed' });
    }
    await repo.updatePasskeyUsage(stored.id, {
      counter: verification.authenticationInfo?.newCounter ?? stored.counter,
      backedUp: verification.authenticationInfo?.credentialBackedUp ?? stored.backedUp,
    });
    const sessionToken = await createSession(stored.userId);
    return { userId: stored.userId, sessionToken };
  }

  async function listForUser(user) {
    if (!user?.userId) throw new ApiError('Authentication required.', 401);
    const rows = await repo.listPasskeysForUser(user.userId);
    return rows.map(toPasskeySummary);
  }

  async function removeForUser(user, passkeyId) {
    if (!user?.userId) throw new ApiError('Authentication required.', 401);
    if (!UUID_PATTERN.test(String(passkeyId || ''))) {
      throw new ApiError('Passkey not found.', 404, { code: 'passkey_missing' });
    }
    const removed = await repo.deletePasskeyForUser(user.userId, passkeyId);
    if (!removed) {
      throw new ApiError('Passkey not found.', 404, { code: 'passkey_missing' });
    }
    return { ok: true };
  }

  return {
    registrationOptions,
    verifyRegistration,
    authenticationOptions,
    verifyAuthentication,
    listForUser,
    removeForUser,
  };
}
