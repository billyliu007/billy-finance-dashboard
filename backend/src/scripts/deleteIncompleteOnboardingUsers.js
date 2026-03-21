/**
 * Remove users who have not finished onboarding (onboarding_completed = FALSE).
 * Related rows cascade-delete (sessions, identities, cash, portfolio, networth_history, etc.).
 *
 * Preview only (default):
 *   node src/scripts/deleteIncompleteOnboardingUsers.js
 *
 * Actually delete:
 *   node src/scripts/deleteIncompleteOnboardingUsers.js --execute
 */
import 'dotenv/config';
import { query } from '../db/client.js';

async function main() {
  const execute = process.argv.includes('--execute');

  const preview = await query(
    `SELECT id, email, display_name, created_at
     FROM users
     WHERE onboarding_completed = FALSE
     ORDER BY created_at ASC`,
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        count: preview.rowCount,
        users: preview.rows,
        execute,
      },
      null,
      2,
    ),
  );

  if (!execute) {
    // eslint-disable-next-line no-console
    console.log('\nNo changes made. Re-run with --execute to DELETE these users and all related data.');
    return;
  }

  if (preview.rowCount === 0) {
    // eslint-disable-next-line no-console
    console.log('Nothing to delete.');
    return;
  }

  const del = await query(
    `DELETE FROM users
     WHERE onboarding_completed = FALSE
     RETURNING id, email, display_name`,
  );

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ deleted: del.rowCount, users: del.rows }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
