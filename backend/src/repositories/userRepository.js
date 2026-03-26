import { randomUUID } from 'node:crypto';
import { query, withDbClient } from '../db/client.js';
import { assertSupportedCurrencyCode } from '../lib/supportedCurrencies.js';

function buildPublicId() {
  return `usr_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export async function createUser({ email = null, displayName = null, onboardingCompleted = false }) {
  const result = await query(
    `INSERT INTO users (email, display_name, public_id, onboarding_completed)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name AS "displayName", public_id AS "publicId", onboarding_completed AS "onboardingCompleted", created_at AS "createdAt"`,
    [email, displayName, buildPublicId(), onboardingCompleted],
  );
  return result.rows[0] || null;
}

export async function findUserById(userId) {
  const result = await query(
    `SELECT id, email, display_name AS "displayName", public_id AS "publicId", onboarding_completed AS "onboardingCompleted",
            COALESCE(UPPER(TRIM(base_currency)), 'USD') AS "baseCurrency", created_at AS "createdAt"
     FROM users
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] || null;
}

export async function findUserByEmail(email) {
  const result = await query(
    `SELECT id, email, display_name AS "displayName", public_id AS "publicId", onboarding_completed AS "onboardingCompleted", created_at AS "createdAt"
     FROM users
     WHERE lower(email) = lower($1)`,
    [email],
  );
  return result.rows[0] || null;
}

export async function upsertIdentity({ userId, provider, providerUserId, providerEmail = null, profile = {} }) {
  const result = await query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_email, profile)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (provider, provider_user_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           provider_email = EXCLUDED.provider_email,
           profile = EXCLUDED.profile
     RETURNING id, user_id AS "userId", provider, provider_user_id AS "providerUserId", provider_email AS "providerEmail"`,
    [userId, provider, providerUserId, providerEmail, JSON.stringify(profile || {})],
  );
  return result.rows[0] || null;
}

export async function findIdentity(provider, providerUserId) {
  const result = await query(
    `SELECT id, user_id AS "userId", provider, provider_user_id AS "providerUserId", provider_email AS "providerEmail"
     FROM user_identities
     WHERE provider = $1 AND provider_user_id = $2`,
    [provider, providerUserId],
  );
  return result.rows[0] || null;
}

export async function markOnboardingCompleted(userId, displayName) {
  const result = await query(
    `UPDATE users
     SET display_name = $2,
         onboarding_completed = TRUE,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, display_name AS "displayName", public_id AS "publicId", onboarding_completed AS "onboardingCompleted", created_at AS "createdAt"`,
    [userId, displayName],
  );
  return result.rows[0] || null;
}

export async function updateUserBaseCurrency(userId, baseCurrency) {
  const code = assertSupportedCurrencyCode(baseCurrency || 'USD', { fieldName: 'baseCurrency' });
  await query(
    `UPDATE users SET base_currency = $2, updated_at = NOW() WHERE id = $1`,
    [userId, code],
  );
  return code;
}

export async function listUsersForSnapshots() {
  const result = await query(
    `SELECT id, email, display_name AS "displayName", onboarding_completed AS "onboardingCompleted",
            COALESCE(UPPER(TRIM(base_currency)), 'USD') AS "baseCurrency"
     FROM users
     WHERE onboarding_completed = TRUE`,
  );
  return result.rows;
}

export async function createSession(userId, sessionToken, expiresAtIsoString) {
  await query(
    `INSERT INTO user_sessions (user_id, session_token, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, sessionToken, expiresAtIsoString],
  );
}

export async function findSession(sessionToken) {
  const result = await query(
    `SELECT s.id, s.user_id AS "userId", s.expires_at AS "expiresAt",
            u.email, u.display_name AS "displayName", u.public_id AS "publicId", u.onboarding_completed AS "onboardingCompleted",
            COALESCE(UPPER(TRIM(u.base_currency)), 'USD') AS "baseCurrency"
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.session_token = $1`,
    [sessionToken],
  );
  return result.rows[0] || null;
}

export async function deleteSession(sessionToken) {
  await query(`DELETE FROM user_sessions WHERE session_token = $1`, [sessionToken]);
}

export async function clearExpiredSessions() {
  await query(`DELETE FROM user_sessions WHERE expires_at < NOW()`);
}

export async function findOrCreateUserByGoogleEmail({ email, displayName }) {
  return withDbClient(async (client) => {
    const existing = await client.query(
      `SELECT id, email, display_name AS "displayName", public_id AS "publicId", onboarding_completed AS "onboardingCompleted", created_at AS "createdAt"
       FROM users
       WHERE lower(email) = lower($1)`,
      [email],
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
    const created = await client.query(
      `INSERT INTO users (email, display_name, public_id, onboarding_completed)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, email, display_name AS "displayName", public_id AS "publicId", onboarding_completed AS "onboardingCompleted", created_at AS "createdAt"`,
      [email, displayName || null, buildPublicId()],
    );
    return created.rows[0];
  });
}
