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
import {
  fetchBinanceUsdtQuotes,
  fetchCoingeckoUsdQuotes,
  fetchCoinbaseProductQuotes,
} from './lib/crypto.js';

const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_SHEET_RANGE = 'Sheet1!A1:Z100';
const FETCH_ERROR_MESSAGE =
  'Failed to fetch Google Sheets data. Check backend environment configuration and sheet permissions.';
const BACKEND_VERSION = resolveBackendVersion();
const FX_PROVIDER = String(process.env.FX_PROVIDER || 'frankfurter').trim().toLowerCase();
const CRYPTO_PROVIDER = String(process.env.CRYPTO_PROVIDER || 'coinbase').trim().toLowerCase();

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
    .map((asset) => ({
      assetSymbol: String(asset.name || '').trim().toUpperCase(),
      providerSymbol: String(asset.providerSymbols?.finnhub || asset.name || '')
        .trim()
        .toUpperCase(),
    }))
    .filter((entry) => entry.assetSymbol && entry.providerSymbol);
}

async function getStockQuoteMap() {
  const stockTargets = getStockSymbols();
  if (stockTargets.length === 0) {
    return {};
  }

  const rawQuotes = await fetchFinnhubQuotes(stockTargets.map((target) => target.providerSymbol));
  return stockTargets.reduce((acc, target) => {
    const quote = rawQuotes[target.providerSymbol];
    if (quote) {
      acc[target.assetSymbol] = {
        ...quote,
        symbol: target.assetSymbol,
      };
    }
    return acc;
  }, {});
}

function getCryptoSymbols() {
  const assets = (PORTFOLIO_CONFIG.assets || [])
    .filter((asset) => /crypto/i.test(String(asset.category || '')))
    .map((asset) => ({
      assetSymbol: String(asset.name || '').trim().toUpperCase(),
      coinbaseProduct: String(asset.providerSymbols?.coinbase || `${asset.name}-USDT`)
        .trim()
        .toUpperCase(),
      coingeckoId: String(asset.providerSymbols?.coingecko || '').trim().toLowerCase(),
      binanceSymbol: String(asset.providerSymbols?.binance || `${asset.name}USDT`)
        .trim()
        .toUpperCase(),
    }))
    .filter((entry) => entry.assetSymbol);
  return assets;
}

async function getCryptoQuoteMap() {
  const cryptoAssets = getCryptoSymbols();
  if (cryptoAssets.length === 0 || CRYPTO_PROVIDER === 'sheet') {
    return {};
  }

  if (CRYPTO_PROVIDER === 'binance') {
    return fetchBinanceUsdtQuotes(
      cryptoAssets.map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.binanceSymbol,
      })),
    );
  }

  if (CRYPTO_PROVIDER === 'coingecko') {
    const coingeckoTargets = cryptoAssets
      .filter((asset) => asset.coingeckoId)
      .map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.coingeckoId,
      }));
    const coingeckoQuotes = await fetchCoingeckoUsdQuotes(coingeckoTargets);
    const missingSymbols = cryptoAssets.filter((asset) => !coingeckoQuotes[asset.assetSymbol]);
    if (missingSymbols.length === 0) {
      return coingeckoQuotes;
    }

    const binanceQuotes = await fetchBinanceUsdtQuotes(
      missingSymbols.map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.binanceSymbol,
      })),
    );
    return {
      ...coingeckoQuotes,
      ...binanceQuotes,
    };
  }

  const coinbaseQuotes = await fetchCoinbaseProductQuotes(
    cryptoAssets.map((asset) => ({
      assetSymbol: asset.assetSymbol,
      providerSymbol: asset.coinbaseProduct,
    })),
  );
  const missingAfterCoinbase = cryptoAssets.filter((asset) => !coinbaseQuotes[asset.assetSymbol]);
  if (missingAfterCoinbase.length === 0) {
    return coinbaseQuotes;
  }

  const coingeckoQuotes = await fetchCoingeckoUsdQuotes(
    missingAfterCoinbase
      .filter((asset) => asset.coingeckoId)
      .map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.coingeckoId,
      })),
  );
  const missingAfterCoingecko = missingAfterCoinbase.filter(
    (asset) => !coingeckoQuotes[asset.assetSymbol],
  );
  if (missingAfterCoingecko.length === 0) {
    return {
      ...coinbaseQuotes,
      ...coingeckoQuotes,
    };
  }

  const binanceQuotes = await fetchBinanceUsdtQuotes(
    missingAfterCoingecko.map((asset) => ({
      assetSymbol: asset.assetSymbol,
      providerSymbol: asset.binanceSymbol,
    })),
  );
  return {
    // coinbase is preferred and should win for overlapping symbols
    ...binanceQuotes,
    ...coingeckoQuotes,
    ...coinbaseQuotes,
  };
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

function nowIsoString() {
  return new Date().toISOString();
}

async function buildProviderDiagnostics() {
  const stockTargets = getStockSymbols();
  const cryptoTargets = getCryptoSymbols();

  const diagnostics = [];

  if (!process.env.FINNHUB_API_KEY) {
    diagnostics.push({
      provider: 'finnhub',
      status: 'disabled',
      message: 'FINNHUB_API_KEY is missing; stock quotes will fall back to sheet.',
      checkedAt: nowIsoString(),
    });
  } else {
    const stockQuotes = await getStockQuoteMap();
    diagnostics.push({
      provider: 'finnhub',
      status: Object.keys(stockQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(stockQuotes).length > 0
          ? `Live stock quotes received (${Object.keys(stockQuotes).length}/${stockTargets.length}).`
          : 'No live stock quotes received from Finnhub; using sheet fallback.',
      checkedAt: nowIsoString(),
    });
  }

  if (CRYPTO_PROVIDER === 'sheet') {
    diagnostics.push({
      provider: 'crypto',
      status: 'disabled',
      message: 'CRYPTO_PROVIDER=sheet; crypto prices are sheet-backed.',
      checkedAt: nowIsoString(),
    });
  } else if (CRYPTO_PROVIDER === 'binance') {
    const binanceQuotes = await fetchBinanceUsdtQuotes(
      cryptoTargets.map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.binanceSymbol,
      })),
    );
    diagnostics.push({
      provider: 'binance',
      status: Object.keys(binanceQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(binanceQuotes).length > 0
          ? `Live crypto quotes received from Binance (${Object.keys(binanceQuotes).length}/${cryptoTargets.length}).`
          : 'No live crypto quotes received from Binance; using sheet fallback.',
      checkedAt: nowIsoString(),
    });
  } else if (CRYPTO_PROVIDER === 'coingecko') {
    const coingeckoTargets = cryptoTargets
      .filter((asset) => asset.coingeckoId)
      .map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.coingeckoId,
      }));
    const coingeckoQuotes = await fetchCoingeckoUsdQuotes(coingeckoTargets);
    const missingSymbols = cryptoTargets.filter((asset) => !coingeckoQuotes[asset.assetSymbol]);
    const binanceQuotes = missingSymbols.length > 0
      ? await fetchBinanceUsdtQuotes(
        missingSymbols.map((asset) => ({
          assetSymbol: asset.assetSymbol,
          providerSymbol: asset.binanceSymbol,
        })),
      )
      : {};
    const resolvedCount = Object.keys(coingeckoQuotes).length + Object.keys(binanceQuotes).length;
    const unresolved = missingSymbols
      .filter((asset) => !binanceQuotes[asset.assetSymbol])
      .map((asset) => asset.assetSymbol);

    diagnostics.push({
      provider: 'coingecko',
      status: Object.keys(coingeckoQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(coingeckoQuotes).length > 0
          ? `CoinGecko returned ${Object.keys(coingeckoQuotes).length} crypto quote(s).`
          : 'CoinGecko returned no crypto quotes.',
      checkedAt: nowIsoString(),
    });

    diagnostics.push({
      provider: 'binance-fallback',
      status:
        unresolved.length === 0 && resolvedCount > 0
          ? missingAfterCoinbase.length === 0
            ? 'not_needed'
            : 'ok'
          : 'error',
      message:
        missingSymbols.length === 0
          ? 'Fallback not needed; CoinGecko covered all symbols.'
          : unresolved.length === 0
            ? `Binance fallback resolved remaining symbols (${Object.keys(binanceQuotes).length}/${missingSymbols.length}).`
            : `Binance fallback failed for: ${unresolved.join(', ')}; these symbols use sheet fallback.`,
      checkedAt: nowIsoString(),
    });
  } else {
    const coinbaseQuotes = await fetchCoinbaseProductQuotes(
      cryptoTargets.map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.coinbaseProduct,
      })),
    );
    const missingAfterCoinbase = cryptoTargets.filter((asset) => !coinbaseQuotes[asset.assetSymbol]);

    diagnostics.push({
      provider: 'coinbase',
      status: Object.keys(coinbaseQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(coinbaseQuotes).length > 0
          ? `Coinbase returned ${Object.keys(coinbaseQuotes).length} crypto quote(s).`
          : 'Coinbase returned no crypto quotes.',
      checkedAt: nowIsoString(),
    });

    if (missingAfterCoinbase.length === 0) {
      diagnostics.push({
        provider: 'coingecko',
        status: 'not_needed',
        message: 'Fallback not needed; Coinbase covered all symbols.',
        checkedAt: nowIsoString(),
      });

      diagnostics.push({
        provider: 'binance-fallback',
        status: 'not_needed',
        message: 'Fallback not needed; Coinbase covered all symbols.',
        checkedAt: nowIsoString(),
      });
      return diagnostics;
    }

    const coingeckoTargets = missingAfterCoinbase
      .filter((asset) => asset.coingeckoId)
      .map((asset) => ({
        assetSymbol: asset.assetSymbol,
        providerSymbol: asset.coingeckoId,
      }));
    const coingeckoQuotes = await fetchCoingeckoUsdQuotes(coingeckoTargets);
    const missingAfterCoingecko = missingAfterCoinbase.filter(
      (asset) => !coingeckoQuotes[asset.assetSymbol],
    );
    const binanceQuotes = missingAfterCoingecko.length > 0
      ? await fetchBinanceUsdtQuotes(
        missingAfterCoingecko.map((asset) => ({
          assetSymbol: asset.assetSymbol,
          providerSymbol: asset.binanceSymbol,
        })),
      )
      : {};
    const resolvedCount =
      Object.keys(coinbaseQuotes).length +
      Object.keys(coingeckoQuotes).length +
      Object.keys(binanceQuotes).length;
    const unresolved = missingAfterCoingecko
      .filter((asset) => !binanceQuotes[asset.assetSymbol])
      .map((asset) => asset.assetSymbol);

    diagnostics.push({
      provider: 'coingecko',
      status: Object.keys(coingeckoQuotes).length > 0 ? 'ok' : 'error',
      message:
        Object.keys(coingeckoQuotes).length > 0
          ? `CoinGecko fallback returned ${Object.keys(coingeckoQuotes).length} crypto quote(s).`
          : 'CoinGecko fallback returned no crypto quotes.',
      checkedAt: nowIsoString(),
    });

    diagnostics.push({
      provider: 'binance-fallback',
      status:
        unresolved.length === 0 && resolvedCount > 0
          ? missingAfterCoinbase.length === 0
            ? 'not_needed'
            : 'ok'
          : 'error',
      message:
        missingAfterCoingecko.length === 0
          ? missingAfterCoinbase.length === 0
            ? 'Fallback not needed; Coinbase covered all symbols.'
            : 'Binance fallback not needed; Coinbase/CoinGecko covered all symbols.'
          : unresolved.length === 0
            ? `Binance fallback resolved remaining symbols (${Object.keys(binanceQuotes).length}/${missingAfterCoingecko.length}).`
            : `Binance fallback failed for: ${unresolved.join(', ')}; these symbols use sheet fallback.`,
      checkedAt: nowIsoString(),
    });
  }

  if (FX_PROVIDER === 'sheet') {
    diagnostics.push({
      provider: 'fx',
      status: 'disabled',
      message: 'FX_PROVIDER=sheet; FX rates are sheet-backed.',
      checkedAt: nowIsoString(),
    });
  } else {
    const fxRates = await getLiveFxRates();
    const hasRates = Number.isFinite(fxRates.USD) && Number.isFinite(fxRates.SGD);
    diagnostics.push({
      provider: FX_PROVIDER,
      status: hasRates ? 'ok' : 'error',
      message: hasRates
        ? 'Live FX rates received for USD/CNY and SGD/CNY.'
        : 'Live FX rates unavailable; using sheet fallback.',
      checkedAt: nowIsoString(),
    });
  }

  return diagnostics;
}

export default function createApp() {
  const app = express();
  app.use(cors());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/dev/status', async (_req, res) => {
    const stockAssets = (PORTFOLIO_CONFIG.assets || []).filter((asset) =>
      /stock/i.test(String(asset.category || '')),
    );
    const cryptoAssets = (PORTFOLIO_CONFIG.assets || []).filter((asset) =>
      /crypto/i.test(String(asset.category || '')),
    );
    try {
      const providerDiagnostics = await buildProviderDiagnostics();
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
            fallback:
              CRYPTO_PROVIDER === 'coinbase'
                ? 'coingecko -> binance -> sheet'
                : CRYPTO_PROVIDER === 'coingecko'
                  ? 'binance -> sheet'
                  : 'sheet',
            symbols: cryptoAssets.map((asset) => {
              const name = String(asset.name || '').toUpperCase();
              if (CRYPTO_PROVIDER === 'coinbase') {
                return String(asset.providerSymbols?.coinbase || `${name}-USDT`).toUpperCase();
              }
              if (CRYPTO_PROVIDER === 'coingecko') {
                return String(asset.providerSymbols?.coingecko || `${name.toLowerCase()}`);
              }
              return String(asset.providerSymbols?.binance || `${name}USDT`).toUpperCase();
            }),
          },
          fx: {
            primary: FX_PROVIDER === 'sheet' ? 'sheet' : FX_PROVIDER,
            fallback: 'sheet',
            pairs: ['USD/CNY', 'SGD/CNY'],
          },
        },
        providerDiagnostics,
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
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: getErrorMessage(error) });
    }
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
