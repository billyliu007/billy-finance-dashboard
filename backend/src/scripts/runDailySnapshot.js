import 'dotenv/config';
import { runDailySnapshots } from '../services/snapshotService.js';

async function run() {
  const results = await runDailySnapshots();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
