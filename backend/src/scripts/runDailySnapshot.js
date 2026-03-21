import 'dotenv/config';
import { runDailySnapshots } from '../services/snapshotService.js';

async function run() {
  const dateUtc = String(process.env.SNAPSHOT_DATE_UTC || '').trim();
  const results = await runDailySnapshots(dateUtc ? { dateUtc } : {});
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
