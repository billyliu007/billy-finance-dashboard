import 'dotenv/config';
import createApp from './app.js';
import { warmFxCache } from './services/pricingGateway.js';
import { SUPPORTED_CURRENCY_CODES } from './lib/supportedCurrencies.js';

const port = Number(process.env.PORT || 4000);
const app = createApp();

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend running on port ${port}`);
  // Warm FX cache asynchronously to avoid a slow first What-if/dashboard load after restarts.
  // eslint-disable-next-line no-console
  warmFxCache(SUPPORTED_CURRENCY_CODES).catch((err) => console.log(`fx_warm_failed: ${err?.message || String(err)}`));
});



