import { query } from '../db/client.js';

const COLUMNS = `id, user_id AS "userId", credential_id AS "credentialId", public_key AS "publicKey",
  counter, transports, device_type AS "deviceType", backed_up AS "backedUp", name,
  created_at AS "createdAt", last_used_at AS "lastUsedAt"`;

function mapRow(row) {
  if (!row) return null;
  return { ...row, counter: Number(row.counter || 0), transports: row.transports || [] };
}

export async function listPasskeysForUser(userId) {
  const result = await query(
    `SELECT ${COLUMNS} FROM user_passkeys WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows.map(mapRow);
}

export async function findPasskeyByCredentialId(credentialId) {
  const result = await query(`SELECT ${COLUMNS} FROM user_passkeys WHERE credential_id = $1`, [credentialId]);
  return mapRow(result.rows[0]);
}

export async function insertPasskey({
  userId,
  credentialId,
  publicKey,
  counter,
  transports,
  deviceType,
  backedUp,
  name,
}) {
  const result = await query(
    `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [userId, credentialId, publicKey, counter, transports || [], deviceType || null, Boolean(backedUp), name || ''],
  );
  return mapRow(result.rows[0]);
}

export async function updatePasskeyUsage(id, { counter, backedUp }) {
  await query(
    `UPDATE user_passkeys SET counter = $2, backed_up = $3, last_used_at = NOW() WHERE id = $1`,
    [id, counter, Boolean(backedUp)],
  );
}

/** Deletes only if the passkey belongs to the user; returns true when a row was removed. */
export async function deletePasskeyForUser(userId, id) {
  const result = await query(`DELETE FROM user_passkeys WHERE id = $1 AND user_id = $2`, [id, userId]);
  return result.rowCount > 0;
}
