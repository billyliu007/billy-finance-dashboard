import 'dotenv/config';
import { withTransaction } from '../db/client.js';

const DEMO_EMAIL = 'demo@myworthtrack.local';

async function run() {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [DEMO_EMAIL],
    );
    if (rows.length === 0) {
      // eslint-disable-next-line no-console
      console.log('Demo user not found; nothing to reset.');
      return;
    }

    const demoUserId = rows[0].id;

    await client.query(`DELETE FROM user_sessions WHERE user_id = $1`, [demoUserId]);
    await client.query(`DELETE FROM user_identities WHERE user_id = $1`, [demoUserId]);
    await client.query(`DELETE FROM cash WHERE user_id = $1`, [demoUserId]);
    await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [demoUserId]);
    await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [demoUserId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [demoUserId]);

    // eslint-disable-next-line no-console
    console.log('Demo account and all related data have been removed.');
  });
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

