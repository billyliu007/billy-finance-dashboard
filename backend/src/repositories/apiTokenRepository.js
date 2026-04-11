import { query } from '../db/client.js';
import { API_TOKEN_PREFIX, generateApiTokenPlain, hashApiTokenPlain } from '../lib/apiTokenCrypto.js';

export { hashApiTokenPlain, readBearerToken } from '../lib/apiTokenCrypto.js';

function normalizeLabel(label) {
  const s = String(label ?? '').trim();
  return s.slice(0, 200);
}

/**
 * @param {string|null|undefined} expiresAtIso
 * @returns {string|null}
 */
function parseOptionalExpiresAt(expiresAtIso) {
  if (expiresAtIso == null || expiresAtIso === '') {
    return null;
  }
  const d = new Date(String(expiresAtIso).trim());
  const t = d.getTime();
  if (!Number.isFinite(t)) {
    throw new Error('expiresAt must be a valid ISO date string.');
  }
  if (t <= Date.now()) {
    throw new Error('expiresAt must be in the future.');
  }
  return d.toISOString();
}

/**
 * @param {string} userId
 * @param {{ label?: string, expiresAt?: string|null }} [options]
 * @returns {Promise<{ id: string, token: string, label: string, createdAt: string, expiresAt: string|null }>}
 */
export async function createUserApiToken(userId, { label = '', expiresAt = null } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) {
    throw new Error('Missing user id.');
  }
  const plain = generateApiTokenPlain();
  const tokenHash = hashApiTokenPlain(plain);
  const lab = normalizeLabel(label);
  const exp = parseOptionalExpiresAt(expiresAt);
  const result = await query(
    `INSERT INTO user_api_tokens (user_id, token_hash, label, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
               label,
               CASE WHEN expires_at IS NULL THEN NULL
                    ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS "expiresAt"`,
    [uid, tokenHash, lab, exp],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    token: plain,
    label: row.label,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listUserApiTokens(userId) {
  const uid = String(userId || '').trim();
  if (!uid) {
    return [];
  }
  const result = await query(
    `SELECT id,
            label,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
            CASE WHEN last_used_at IS NULL THEN NULL
                 ELSE to_char(last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS "lastUsedAt",
            CASE WHEN expires_at IS NULL THEN NULL
                 ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS "expiresAt",
            CASE WHEN revoked_at IS NULL THEN NULL
                 ELSE to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS "revokedAt"
     FROM user_api_tokens
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [uid],
  );
  return result.rows;
}

/**
 * @param {string} userId
 * @param {string} tokenId
 * @returns {Promise<boolean>} true if a row was revoked
 */
export async function revokeUserApiToken(userId, tokenId) {
  const uid = String(userId || '').trim();
  const tid = String(tokenId || '').trim();
  if (!uid || !tid) {
    return false;
  }
  const result = await query(
    `UPDATE user_api_tokens
     SET revoked_at = NOW()
     WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`,
    [uid, tid],
  );
  return result.rowCount > 0;
}

/**
 * Validates plain token, updates last_used_at, returns user session-shaped row (same keys as findSession user fields).
 * @param {string} plainToken
 * @returns {Promise<object|null>}
 */
export async function resolveUserFromApiTokenPlain(plainToken) {
  const plain = String(plainToken || '').trim();
  if (!plain || !plain.startsWith(API_TOKEN_PREFIX)) {
    return null;
  }
  const tokenHash = hashApiTokenPlain(plain);
  const result = await query(
    `UPDATE user_api_tokens t
     SET last_used_at = NOW()
     FROM users u
     WHERE t.token_hash = $1
       AND t.user_id = u.id
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > NOW())
     RETURNING u.id AS "userId",
               u.email,
               u.display_name AS "displayName",
               u.public_id AS "publicId",
               u.onboarding_completed AS "onboardingCompleted",
               COALESCE(UPPER(TRIM(u.base_currency)), 'USD') AS "baseCurrency",
               t.id AS "apiTokenId"`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    publicId: row.publicId,
    onboardingCompleted: row.onboardingCompleted,
    baseCurrency: row.baseCurrency,
    apiTokenId: row.apiTokenId,
  };
}
