import 'dotenv/config';
import { withDbClient } from '../db/client.js';

const DEMO_EMAIL = 'demo@myworthtrack.local';

async function run() {
  await withDbClient(async (client) => {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `SELECT id FROM users WHERE lower(email) = lower($1)`,
        [DEMO_EMAIL],
      );
      if (rows.length === 0) {
        // eslint-disable-next-line no-console
        console.log('Demo user not found; nothing to reset.');
        await client.query('COMMIT');
        return;
      }

      const demoUserId = rows[0].id;

      await client.query(`DELETE FROM user_sessions WHERE user_id = $1`, [demoUserId]);
      await client.query(`DELETE FROM user_identities WHERE user_id = $1`, [demoUserId]);
      await client.query(`DELETE FROM cash WHERE user_id = $1`, [demoUserId]);
      await client.query(`DELETE FROM portfolio_positions WHERE user_id = $1`, [demoUserId]);
      await client.query(`DELETE FROM networth_history WHERE user_id = $1`, [demoUserId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [demoUserId]);

      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log('Demo account and all related data have been removed.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

