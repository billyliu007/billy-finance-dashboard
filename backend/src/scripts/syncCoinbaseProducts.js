import 'dotenv/config';
import { withTransaction } from '../db/client.js';

const COINBASE_PRODUCTS_URL = 'https://api.exchange.coinbase.com/products';

async function fetchCoinbaseProducts() {
  const response = await fetch(COINBASE_PRODUCTS_URL, {
    headers: {
      'User-Agent': 'billy-finance-dashboard/coinbase-products-sync',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Coinbase products fetch failed (${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected Coinbase products response; expected an array.');
  }
  return data;
}

function normalizeProduct(raw) {
  const productId = String(raw?.id || '').trim().toUpperCase();
  const baseCurrency = String(raw?.base_currency || '').trim().toUpperCase();
  const quoteCurrency = String(raw?.quote_currency || '').trim().toUpperCase();
  const status = String(raw?.status || 'unknown').trim().toLowerCase();
  if (!productId || !baseCurrency || !quoteCurrency) {
    return null;
  }

  return {
    productId,
    baseCurrency,
    quoteCurrency,
    status,
    raw,
  };
}

async function upsertProducts(products) {
  const rows = products
    .map(normalizeProduct)
    .filter(
      (item) => item
        && (item.quoteCurrency === 'USDC' || item.quoteCurrency === 'USDT'),
    );
  const now = new Date().toISOString();

  await withTransaction(async (client) => {
    // Always keep only USD/USDT-quoted products in the table.
    await client.query(
      `DELETE FROM coinbase_products
       WHERE quote_currency NOT IN ('USDC', 'USDT')`,
    );
    const sql = `
        INSERT INTO coinbase_products (
          product_id,
          base_currency,
          quote_currency,
          status,
          raw,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
        ON CONFLICT (product_id)
        DO UPDATE SET
          base_currency = EXCLUDED.base_currency,
          quote_currency = EXCLUDED.quote_currency,
          status = EXCLUDED.status,
          raw = EXCLUDED.raw,
          updated_at = EXCLUDED.updated_at;
      `;

    for (const row of rows) {
      await client.query(sql, [
        row.productId,
        row.baseCurrency,
        row.quoteCurrency,
        row.status,
        JSON.stringify(row.raw ?? {}),
        now,
      ]);
    }
  });

  return { insertedOrUpdated: rows.length };
}

async function run() {
  const products = await fetchCoinbaseProducts();
  const result = await upsertProducts(products);
  // eslint-disable-next-line no-console
  console.log(`Synced Coinbase products: ${result.insertedOrUpdated}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

