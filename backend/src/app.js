import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { buildNetWorthPayload } from './services/netWorthService.js';
import { buildPortfolioPayload } from './services/portfolioService.js';
import {
  buildProviderDiagnosticsForPositions,
  getCryptoQuoteMapForPositions,
  getLiveFxRates,
  getStockQuoteMapForPositions,
} from './services/marketDataService.js';
import {
  buildAppleAuthUrl,
  buildGoogleAuthUrl,
  buildSessionCookie,
  buildWechatAuthUrl,
  clearSessionCookie,
  completeAppleLogin,
  completeGoogleLogin,
  completeWechatLogin,
  resolveSessionFromRequest,
} from './services/authService.js';
import {
  listCashComponents,
  listCoinbaseProducts,
  createCryptoPositionFromCoinbaseProduct,
  listUsStockSymbols,
  createStockPositionFromSymbol,
  listNetWorthHistory,
  listPortfolioPositions,
  replaceCashComponents,
  replacePortfolioPositions,
} from './repositories/financeRepository.js';
import { markOnboardingCompleted } from './repositories/userRepository.js';
import { runDailySnapshots } from './services/snapshotService.js';

const BACKEND_VERSION = resolveBackendVersion();
const FRONTEND_BASE_URL = String(process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const DATA_SOURCE = String(process.env.DATA_SOURCE || 'db').trim().toLowerCase();

function resolveBackendVersion() {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

function getErrorMessage(error) {
  const data = error?.response?.data;
  if (data?.error?.message) return data.error.message;
  if (data?.message && typeof data.message === 'string') return data.message;
  if (error?.message) return String(error.message);
  return 'Request failed.';
}

function parseOnboardingPayload(body) {
  const displayName = String(body?.displayName || '').trim();
  const cashComponents = Array.isArray(body?.cashComponents) ? body.cashComponents : [];
  const positions = Array.isArray(body?.positions) ? body.positions : [];
  if (!displayName || displayName.length < 2 || displayName.length > 30) {
    throw new Error('Display name must be between 2 and 30 characters.');
  }
  if (cashComponents.length === 0) {
    throw new Error('At least one cash/debt component is required.');
  }
  if (positions.length === 0) {
    throw new Error('At least one asset position is required.');
  }
  const normalizedCash = cashComponents.map((item, index) => {
    const key = String(item?.key || `component_${index + 1}`).trim().toLowerCase();
    const name = String(item?.name || key).trim();
    const currency = String(item?.currency || 'CNY').trim().toUpperCase();
    const type = String(item?.type || 'asset').trim().toLowerCase();
    const amount = Number(item?.amount || 0);
    if (!key || !name || !currency || !['asset', 'liability'].includes(type) || !Number.isFinite(amount)) {
      throw new Error('Invalid cash/debt input.');
    }
    return {
      key,
      name,
      currency,
      type,
      category: String(item?.category || 'Cash'),
      amount,
    };
  });

  const normalizedPositions = positions.map((item) => {
    const symbol = String(item?.symbol || '').trim().toUpperCase();
    const category = String(item?.category || '').trim();
    const qty = Number(item?.qty || 0);
    const purchasePrice = Number(item?.purchasePrice || 0);
    if (!symbol || !category || !Number.isFinite(qty) || !Number.isFinite(purchasePrice)) {
      throw new Error('Invalid asset input.');
    }
    return {
      symbol,
      category,
      qty,
      purchasePrice,
      marketProvider: item?.marketProvider || null,
      marketInstrumentId: item?.marketInstrumentId || null,
    };
  });

  return {
    displayName,
    cashComponents: normalizedCash,
    positions: normalizedPositions,
  };
}

function redirectToFrontend(res, path, message = null) {
  const params = new URLSearchParams();
  if (message) {
    params.set('message', message);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  res.redirect(`${FRONTEND_BASE_URL}${path}${suffix}`);
}

async function resolveDashboardPayload(userId) {
  if (DATA_SOURCE !== 'db' && DATA_SOURCE !== 'hybrid') {
    throw new Error(`Unsupported DATA_SOURCE value: ${DATA_SOURCE}. Expected db or hybrid.`);
  }
  const [cashComponents, positions, history] = await Promise.all([
    listCashComponents(userId),
    listPortfolioPositions(userId),
    listNetWorthHistory(userId),
  ]);
  const [stockQuotes, cryptoQuotes, fxRates] = await Promise.all([
    getStockQuoteMapForPositions(positions),
    getCryptoQuoteMapForPositions(positions),
    getLiveFxRates(),
  ]);
  const netWorth = buildNetWorthPayload({
    cashComponents,
    positions,
    history,
    stockQuotes,
    cryptoQuotes,
    fxRatesOverride: fxRates,
  });
  const portfolio = buildPortfolioPayload({
    positions,
    stockQuotes,
    cryptoQuotes,
  });
  return { netWorth, portfolio, fxRates, positions };
}

export default function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (origin, cb) => cb(null, origin || true),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(async (req, _res, next) => {
    try {
      req.auth = await resolveSessionFromRequest(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  function requireAuth(req, res, next) {
    if (!req.auth?.user?.userId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    return next();
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/providers', (_req, res) => {
    res.json({
      providers: [
        { key: 'google', enabled: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID) },
        { key: 'apple', enabled: Boolean(process.env.APPLE_CLIENT_ID) },
        { key: 'wechat', enabled: Boolean(process.env.WECHAT_APP_ID) },
      ],
    });
  });

  app.get('/api/auth/google/start', (_req, res) => {
    try {
      return res.redirect(buildGoogleAuthUrl());
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const code = String(req.query.code || '');
      if (!code) {
        return redirectToFrontend(res, '/login', 'Google authorization code missing.');
      }
      const login = await completeGoogleLogin(code);
      res.setHeader('Set-Cookie', buildSessionCookie(login.sessionToken));
      return redirectToFrontend(res, '/');
    } catch (error) {
      return redirectToFrontend(res, '/login', getErrorMessage(error));
    }
  });

  app.get('/api/auth/apple/start', (_req, res) => {
    try {
      return res.redirect(buildAppleAuthUrl());
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.all('/api/auth/apple/callback', async (req, res) => {
    try {
      const code = String(req.query.code || req.body?.code || '');
      if (!code) {
        return redirectToFrontend(res, '/login', 'Apple authorization code missing.');
      }
      const login = await completeAppleLogin(code);
      res.setHeader('Set-Cookie', buildSessionCookie(login.sessionToken));
      return redirectToFrontend(res, '/');
    } catch (error) {
      return redirectToFrontend(res, '/login', getErrorMessage(error));
    }
  });

  app.get('/api/auth/wechat/start', (_req, res) => {
    try {
      return res.redirect(buildWechatAuthUrl());
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/auth/wechat/callback', async (req, res) => {
    try {
      const code = String(req.query.code || '');
      if (!code) {
        return redirectToFrontend(res, '/login', 'WeChat authorization code missing.');
      }
      const login = await completeWechatLogin(code);
      res.setHeader('Set-Cookie', buildSessionCookie(login.sessionToken));
      return redirectToFrontend(res, '/');
    } catch (error) {
      return redirectToFrontend(res, '/login', getErrorMessage(error));
    }
  });

  app.get('/api/auth/session', (req, res) => {
    if (!req.auth?.user) {
      return res.status(200).json({ authenticated: false });
    }
    return res.status(200).json({
      authenticated: true,
      user: {
        id: req.auth.user.userId,
        email: req.auth.user.email,
        displayName: req.auth.user.displayName,
        publicId: req.auth.user.publicId,
        onboardingCompleted: req.auth.user.onboardingCompleted,
      },
    });
  });

  app.post('/api/auth/logout', async (req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  });

  app.get('/api/onboarding/status', requireAuth, async (req, res) => {
    const [cashComponents, positions] = await Promise.all([
      listCashComponents(req.auth.user.userId),
      listPortfolioPositions(req.auth.user.userId),
    ]);
    return res.json({
      onboardingCompleted: req.auth.user.onboardingCompleted,
      hasCashComponents: cashComponents.length > 0,
      hasPositions: positions.length > 0,
      user: {
        email: req.auth.user.email,
        displayName: req.auth.user.displayName,
        publicId: req.auth.user.publicId,
      },
    });
  });

  app.post('/api/onboarding/initialize', requireAuth, async (req, res) => {
    try {
      const userId = req.auth.user.userId;
      const parsed = parseOnboardingPayload(req.body || {});
      await replaceCashComponents(userId, parsed.cashComponents);
      await replacePortfolioPositions(userId, parsed.positions);
      const updatedUser = await markOnboardingCompleted(userId, parsed.displayName);
      return res.status(200).json({
        ok: true,
        user: {
          email: updatedUser.email,
          displayName: updatedUser.displayName,
          publicId: updatedUser.publicId,
          onboardingCompleted: updatedUser.onboardingCompleted,
        },
      });
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/market/coinbase-products', requireAuth, async (req, res) => {
    try {
      const queryText = String(req.query.q || '').trim();
      const limit = Number(req.query.limit || 200);
      const products = await listCoinbaseProducts({ queryText, limit });
      return res.json({ products });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/market/us-stock-symbols', requireAuth, async (req, res) => {
    try {
      const queryText = String(req.query.q || '').trim();
      const limit = Number(req.query.limit || 50);
      const symbols = await listUsStockSymbols({ queryText, limit });
      return res.json({ symbols });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post('/api/portfolio/positions/crypto', requireAuth, async (req, res) => {
    try {
      const productId = String(req.body?.productId || '').trim();
      const qty = Number(req.body?.qty);
      const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
      const result = await createCryptoPositionFromCoinbaseProduct({
        userId: req.auth.user.userId,
        productId,
        qty,
        avgCostPerUnit,
      });
      return res.status(201).json({ ok: true, ...result });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = /already exists/i.test(message) ? 409 : 400;
      return res.status(status).json({ message });
    }
  });

  app.post('/api/portfolio/positions/stock', requireAuth, async (req, res) => {
    try {
      const symbol = String(req.body?.symbol || '').trim().toUpperCase();
      const qty = Number(req.body?.qty);
      const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
      const result = await createStockPositionFromSymbol({
        userId: req.auth.user.userId,
        symbol,
        qty,
        avgCostPerUnit,
      });
      return res.status(201).json({ ok: true, ...result });
    } catch (error) {
      const message = getErrorMessage(error);
      const status = /already exists/i.test(message) ? 409 : 400;
      return res.status(status).json({ message });
    }
  });

  app.get('/api/dashboard/net-worth', requireAuth, async (req, res) => {
    try {
      const payload = await resolveDashboardPayload(req.auth.user.userId);
      return res.json(payload.netWorth);
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dashboard/portfolio', requireAuth, async (req, res) => {
    try {
      const payload = await resolveDashboardPayload(req.auth.user.userId);
      return res.json(payload.portfolio);
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dev/status', requireAuth, async (req, res) => {
    try {
      const positions = await listPortfolioPositions(req.auth.user.userId);
      const providerDiagnostics = await buildProviderDiagnosticsForPositions(positions);
      res.json({
        backendVersion: BACKEND_VERSION,
        storage: {
          primary: DATA_SOURCE === 'hybrid' ? 'postgres+legacy' : 'postgres',
          userScoped: true,
        },
        auth: {
          providers: {
            google: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
            apple: Boolean(process.env.APPLE_CLIENT_ID),
            wechat: Boolean(process.env.WECHAT_APP_ID),
          },
          onboardingCompleted: req.auth.user.onboardingCompleted,
        },
        providerDiagnostics,
      });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post('/api/internal/snapshot/daily', async (req, res) => {
    const token = String(req.headers['x-cron-token'] || '');
    const expectedToken = String(process.env.SNAPSHOT_CRON_TOKEN || '');
    if (!expectedToken || token !== expectedToken) {
      return res.status(401).json({ message: 'Unauthorized cron invocation.' });
    }
    try {
      const results = await runDailySnapshots();
      return res.status(200).json({ ok: true, results });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  return app;
}
