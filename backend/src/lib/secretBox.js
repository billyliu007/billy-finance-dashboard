import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets stored in the database (exchange API keys).
 * Key: EXCHANGE_KEY_ENCRYPTION_KEY (32 bytes, base64 or hex). Required in production;
 * development falls back to a fixed insecure key so local runs work.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */
function resolveKey() {
  const raw = String(process.env.EXCHANGE_KEY_ENCRYPTION_KEY || '').trim();
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('EXCHANGE_KEY_ENCRYPTION_KEY must be 32 bytes (base64 or hex).');
    return buf;
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('EXCHANGE_KEY_ENCRYPTION_KEY must be set in production.');
  }
  return createHash('sha256').update('dev-insecure-exchange-key').digest();
}

export function encryptSecret(plain, key = resolveKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptSecret(payload, key = resolveKey()) {
  const [version, iv, tag, data] = String(payload || '').split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unreadable stored secret.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
