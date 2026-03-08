import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
import DASHBOARD_CONFIG from './config/dashboardConfig.js';
import PORTFOLIO_CONFIG from './config/portfolioConfig.js';
import { buildNetWorthPayload } from './services/netWorthService.js';
import { buildPortfolioPayload } from './services/portfolioService.js';
import { fetchFinnhubQuotes } from './lib/finnhub.js';
import { fetchFrankfurterFxRates } from './lib/fx.js';
import { fetchBinanceUsdtQuotes } from './lib/crypto.js';

const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_SHEET_RANGE = 'Sheet1!A1:Z100';
const FETCH_ERROR_MESSAGE =
  'Failed to fetch Google Sheets data. Check backend environment configuration and sheet permissions.';
const BACKEND_VERSION = resolveBackendVersion();
const FX_PROVIDER = String(process.env.FX_PROVIDER || 'frankfurter').trim().toLowerCase();
const CRYPTO_PROVIDER = String(process.env.CRYPTO_PROVIDER || 'binance').trim().toLowerCase();

function resolveBackendVersion() {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

function mapSheetValues(values = []) {
  if (values.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = values;
  return { headers, rows };
}

function getGoogleCredentials() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in environment.');
  }

  return {
    email: clientEmail,
    key: privateKey,
  };
}

function getSheetConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE || DEFAULT_SHEET_RANGE;

  if (!spreadsheetId) {
    throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID in environment.');
  }

  return { spreadsheetId, defaultRange: range };
}

function createSheetsClient() {
  const credentials = getGoogleCredentials();
  const { spreadsheetId, defaultRange } = getSheetConfig();

  const auth = new google.auth.JWT({
    email: credentials.email,
    key: credentials.key,
    scopes: [SHEETS_READONLY_SCOPE],
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    spreadsheetId,
    defaultRange,
  };
}

function parseRangesParam(rawValue) {
  if (typeof rawValue !== 'string') {
    return [];
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function fetchSheetRows(rangeOverride) {
  const { sheets, spreadsheetId, defaultRange } = createSheetsClient();
  const range = rangeOverride || defaultRange;

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return mapSheetValues(response.data.values);
}

async function fetchMultipleSheetRows(ranges) {
  const { sheets, spreadsheetId } = createSheetsClient();
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  });

  const valueRanges = response.data.valueRanges || [];
  return ranges.map((range, index) => {
    const values = valueRanges[index]?.values;
    return { range, ...mapSheetValues(values) };
  });
}

function getStockSymbols() {
  return (PORTFOLIO_CONFIG.assets || [])
    .filter((asset) => /stock/i.test(String(asset.category || '')))
    .map((asset) => String(asset.name || '').trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);
}

async function getStockQuoteMap() {
  const stockSymbols = getStockSymbols();
  if (stockSymbols.length === 0) {
    return {};
  }

  return fetchFinnhubQuotes(stockSymbols);
}

function getCryptoSymbols() {
  return (PORTFOLIO_CONFIG.assets || [])
    .filter((asset) => /crypto/i.test(String(asset.category || '')))
    .map((asset) => String(asset.name || '').trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);
}

async function getCryptoQuoteMap() {
  const cryptoSymbols = getCryptoSymbols();
  if (cryptoSymbols.length === 0 || CRYPTO_PROVIDER === 'sheet') {
    return {};
  }

  if (CRYPTO_PROVIDER === 'binance') {
    return fetchBinanceUsdtQuotes(cryptoSymbols);
  }

  return {};
}

async function getLiveFxRates() {
  if (FX_PROVIDER === 'sheet') {
    return {};
  }

  if (FX_PROVIDER === 'frankfurter') {
    return fetchFrankfurterFxRates();
  }

  return {};
}

export default function createApp() {
  const app = express();
  app.use(cors());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/dev/status', (_req, res) => {
    const stockAssets = (PORTFOLIO_CONFIG.assets || []).filter((asset) =>
      /stock/i.test(String(asset.category || '')),
    );
    const cryptoAssets = (PORTFOLIO_CONFIG.assets || []).filter((asset) =>
      /crypto/i.test(String(asset.category || '')),
    );

    res.json({
      backendVersion: BACKEND_VERSION,
      marketData: {
        stocks: {
          primary: process.env.FINNHUB_API_KEY ? 'finnhub' : 'sheet',
          fallback: 'sheet',
          symbols: stockAssets.map((asset) => String(asset.name || '').toUpperCase()),
        },
        crypto: {
          primary: CRYPTO_PROVIDER === 'sheet' ? 'sheet' : CRYPTO_PROVIDER,
          fallback: 'sheet',
          symbols: cryptoAssets.map((asset) => `${String(asset.name || '').toUpperCase()}/USDT`),
        },
        fx: {
          primary: FX_PROVIDER === 'sheet' ? 'sheet' : FX_PROVIDER,
          fallback: 'sheet',
          pairs: ['USD/CNY', 'SGD/CNY'],
        },
      },
      sheetBackedData: [
        {
          key: 'net_worth_cash_debt',
          label: 'Net worth cash/debt components',
          range: DASHBOARD_CONFIG.netWorthRange,
          notes: 'Cash/debt values from configured cell references',
        },
        {
          key: 'fx_rates',
          label: 'FX rates (USD/CNY, SGD/CNY)',
          range: DASHBOARD_CONFIG.forexRange,
          notes: 'Used for CNY conversion in net worth totals',
        },
        {
          key: 'cashflow_history',
          label: 'Cashflow and net worth history',
          range: DASHBOARD_CONFIG.cashflowRange,
          notes: 'Used for performance trend, ATH/ATL, and KPI history',
        },
        {
          key: 'portfolio_positions',
          label: 'Portfolio quantities and cost basis',
          range: PORTFOLIO_CONFIG.range,
          notes: 'Qty and purchase prices remain sheet-backed',
        },
        {
          key: 'crypto_current_prices',
          label: 'Crypto current prices',
          range: PORTFOLIO_CONFIG.range,
          notes: 'Used as fallback if live crypto provider is unavailable',
        },
      ],
    });
  });

  app.get('/api/sheet', async (req, res) => {
    try {
      const rangeOverride = typeof req.query.range === 'string' ? req.query.range : undefined;
      const data = await fetchSheetRows(rangeOverride);
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/sheets', async (req, res) => {
    try {
      const ranges = parseRangesParam(req.query.ranges);

      if (ranges.length === 0) {
        return res.status(400).json({ message: 'Missing required query parameter: ranges' });
      }

      const sheetsData = await fetchMultipleSheetRows(ranges);
      return res.json({ sheets: sheetsData });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  function getErrorMessage(error) {
    const data = error?.response?.data;
    if (data?.error?.message) return data.error.message;
    if (data?.message && typeof data.message === 'string') return data.message;
    const msg = error?.message || '';
    if (msg) return msg;
    return FETCH_ERROR_MESSAGE;
  }

  app.get('/api/dashboard/net-worth', async (_req, res) => {
    try {
      const ranges = [
        DASHBOARD_CONFIG.netWorthRange,
        DASHBOARD_CONFIG.forexRange,
        PORTFOLIO_CONFIG.range,
        DASHBOARD_CONFIG.cashflowRange,
      ];
      const sheetsData = await fetchMultipleSheetRows(ranges);
      const [netWorthSheet, forexSheet, portfolioSheet, cashflowSheet] = sheetsData;
      const stockQuotes = await getStockQuoteMap();
      const cryptoQuotes = await getCryptoQuoteMap();
      const fxRates = await getLiveFxRates();
      const payload = buildNetWorthPayload({
        netWorthSheet,
        forexSheet,
        portfolioSheet,
        cashflowSheet,
        stockQuotes,
        cryptoQuotes,
        fxRatesOverride: fxRates,
      });
      return res.json(payload);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dashboard/portfolio', async (_req, res) => {
    try {
      const portfolioSheet = await fetchSheetRows(PORTFOLIO_CONFIG.range);
      const stockQuotes = await getStockQuoteMap();
      const cryptoQuotes = await getCryptoQuoteMap();
      const payload = buildPortfolioPayload({
        ...portfolioSheet,
        stockQuotes,
        cryptoQuotes,
      });
      return res.json(payload);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  return app;
}
