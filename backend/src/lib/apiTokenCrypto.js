import { createHmac, randomBytes } from 'node:crypto';

export const API_TOKEN_PREFIX = 'bfpat_';

function getPepper() {
  const p = String(process.env.API_TOKEN_PEPPER || '').trim();
  if (p) {
    return p;
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('API_TOKEN_PEPPER must be set in production.');
  }
  return 'dev-insecure-api-token-pepper';
}

/**
 * @param {string} plainToken
 * @returns {string} hex digest stored in user_api_tokens.token_hash
 */
export function hashApiTokenPlain(plainToken) {
  const pepper = getPepper();
  return createHmac('sha256', pepper).update(String(plainToken || ''), 'utf8').digest('hex');
}

/**
 * @param {string} authorizationHeader
 * @returns {string|null}
 */
export function readBearerToken(authorizationHeader) {
  const raw = String(authorizationHeader || '').trim();
  const m = /^Bearer\s+(\S+)/i.exec(raw);
  return m ? m[1].trim() : null;
}

export function generateApiTokenPlain() {
  return `${API_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
}
