import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { deleteJson, fetchJson, postJson } from './api.js';

export function isPasskeySupported() {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** True when the user closed or cancelled the system passkey prompt (not an error to show). */
export function isPasskeyCancelled(error) {
  const name = error?.name || error?.cause?.name;
  return name === 'NotAllowedError' || name === 'AbortError' || error?.code === 'ERROR_CEREMONY_ABORTED';
}

/**
 * Translate a passkey error into a user-facing message.
 * @param {Error & { code?: string }} error
 * @param {(key: string) => string} t
 */
export function describePasskeyError(error, t) {
  if (error?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || error?.name === 'InvalidStateError') {
    return t('passkeys.errors.passkey_exists');
  }
  if (error?.code) {
    const key = `passkeys.errors.${error.code}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return error?.message || t('passkeys.errors.passkey_failed');
}

/** Run the browser's passkey sign-in; the backend sets the session cookie on success. */
export async function signInWithPasskey() {
  const optionsJSON = await postJson('/api/auth/passkey/login/options', {});
  const response = await startAuthentication({ optionsJSON });
  return postJson('/api/auth/passkey/login/verify', { response });
}

/** Create a passkey for the signed-in account. */
export async function registerPasskey(name) {
  const optionsJSON = await postJson('/api/auth/passkey/register/options', {});
  const response = await startRegistration({ optionsJSON });
  const result = await postJson('/api/auth/passkey/register/verify', { response, name });
  return result?.passkey;
}

export async function listPasskeys() {
  const result = await fetchJson('/api/auth/passkey');
  return Array.isArray(result?.passkeys) ? result.passkeys : [];
}

export async function removePasskey(id) {
  return deleteJson(`/api/auth/passkey/${encodeURIComponent(id)}`);
}
