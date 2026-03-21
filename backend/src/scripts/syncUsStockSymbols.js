import 'dotenv/config';
import { withTransaction } from '../db/client.js';

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'billy-finance-dashboard/us-stock-symbols-sync',
      Accept: 'text/plain',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Fetch failed (${response.status}) for ${url}: ${text || response.statusText}`);
  }
  return response.text();
}

function parsePipeFile(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const header = lines[0].split('|').map((h) => h.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    if (/^File Creation Time/i.test(line)) {
      break;
    }
    const values = line.split('|');
    const row = {};
    header.forEach((key, index) => {
      row[key] = values[index] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function toBoolFlag(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'Y') return true;
  if (normalized === 'N') return false;
  return null;
}

function normalizeNasdaqListedRow(row) {
  const symbol = String(row?.Symbol || '').trim().toUpperCase();
  if (!symbol) return null;

  return {
    symbol,
    securityName: String(row?.['Security Name'] || '').trim() || null,
    exchange: 'NASDAQ',
    marketCategory: String(row?.['Market Category'] || '').trim() || null,
    etf: toBoolFlag(row?.ETF) ?? false,
    testIssue: toBoolFlag(row?.['Test Issue']) ?? false,
    financialStatus: String(row?.['Financial Status'] || '').trim() || null,
    roundLotSize: Number.isFinite(Number(row?.['Round Lot Size'])) ? Number(row['Round Lot Size']) : null,
    raw: row,
  };
}

function normalizeOtherListedRow(row) {
  const symbol = String(row?.['ACT Symbol'] || '').trim().toUpperCase();
  if (!symbol) return null;

  const exchange = String(row?.Exchange || '').trim().toUpperCase();

  return {
    symbol,
    securityName: String(row?.['Security Name'] || '').trim() || null,
    exchange: exchange || null,
    marketCategory: null,
    etf: toBoolFlag(row?.ETF) ?? false,
    testIssue: toBoolFlag(row?.['Test Issue']) ?? false,
    financialStatus: null,
    roundLotSize: Number.isFinite(Number(row?.['Round Lot Size'])) ? Number(row['Round Lot Size']) : null,
    raw: row,
  };
}

function buildUpsertSql() {
  return `
    INSERT INTO us_stock_symbols (
      symbol,
      security_name,
      exchange,
      market_category,
      etf,
      test_issue,
      financial_status,
      round_lot_size,
      raw,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
    ON CONFLICT (symbol)
    DO UPDATE SET
      security_name = EXCLUDED.security_name,
      exchange = EXCLUDED.exchange,
      market_category = EXCLUDED.market_category,
      etf = EXCLUDED.etf,
      test_issue = EXCLUDED.test_issue,
      financial_status = EXCLUDED.financial_status,
      round_lot_size = EXCLUDED.round_lot_size,
      raw = EXCLUDED.raw,
      updated_at = EXCLUDED.updated_at;
  `;
}

async function run() {
  const [nasdaqText, otherText] = await Promise.all([
    fetchText(NASDAQ_LISTED_URL),
    fetchText(OTHER_LISTED_URL),
  ]);

  const nasdaqRows = parsePipeFile(nasdaqText).map(normalizeNasdaqListedRow).filter(Boolean);
  const otherRows = parsePipeFile(otherText).map(normalizeOtherListedRow).filter(Boolean);

  const combined = [...nasdaqRows, ...otherRows]
    .filter((row) => row.exchange && !row.testIssue);

  const now = new Date().toISOString();
  const upsertSql = buildUpsertSql();

  await withTransaction(async (client) => {
    for (const row of combined) {
      await client.query(upsertSql, [
        row.symbol,
        row.securityName,
        row.exchange,
        row.marketCategory,
        Boolean(row.etf),
        Boolean(row.testIssue),
        row.financialStatus,
        row.roundLotSize,
        JSON.stringify(row.raw ?? {}),
        now,
      ]);
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Synced US stock symbols: ${combined.length}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

