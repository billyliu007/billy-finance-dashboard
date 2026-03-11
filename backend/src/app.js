import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { getErrorMessage, redirectToFrontend } from './lib/requestHelpers.js';
import { parseOnboardingPayload } from './lib/onboardingPayload.js';
import {
  buildProviderDiagnosticsForPositions,
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
  resolveOrCreateDemoUser,
  createUserSession,
} from './services/authService.js';
import {
  listCashComponents,
  listCoinbaseProducts,
  createCryptoPositionFromCoinbaseProduct,
  listCurrencies,
  listUsStockSymbols,
  createStockPositionFromSymbol,
  updatePosition,
  deletePosition,
  listPortfolioPositions,
  replaceCashComponents,
  replacePortfolioPositions,
} from './repositories/financeRepository.js';
import { markOnboardingCompleted, updateUserBaseCurrency } from './repositories/userRepository.js';
import { resolveDashboardPayload } from './services/dashboardService.js';
import { runDailySnapshots } from './services/snapshotService.js';

const BACKEND_VERSION = resolveBackendVersion();

function resolveBackendVersion() {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.version || 'unknown');
  } catch {
    return 'unknown';
  }
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
        baseCurrency: req.auth.user.baseCurrency || 'USD',
      },
    });
  });

  app.post('/api/auth/logout', async (req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  });

  app.post('/api/auth/demo', async (_req, res) => {
    try {
      const demoUser = await resolveOrCreateDemoUser();
      const sessionToken = await createUserSession(demoUser.id);
      res.setHeader('Set-Cookie', buildSessionCookie(sessionToken));
      return res.status(200).json({
        authenticated: true,
        user: {
          id: demoUser.id,
          email: demoUser.email,
          displayName: demoUser.displayName,
          publicId: demoUser.publicId,
          onboardingCompleted: demoUser.onboardingCompleted,
          baseCurrency: demoUser.baseCurrency || 'USD',
        },
      });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
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

  app.get('/api/currencies', requireAuth, async (req, res) => {
    try {
      const currencies = await listCurrencies();
      return res.json({ currencies });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
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

  app.patch('/api/portfolio/positions/:symbol', requireAuth, async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const qty = Number(req.body?.qty);
      const avgCostPerUnit = Number(req.body?.avgCostPerUnit);
      const result = await updatePosition({
        userId: req.auth.user.userId,
        symbol,
        qty,
        avgCostPerUnit,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete('/api/portfolio/positions/:symbol', requireAuth, async (req, res) => {
    try {
      const symbol = String(req.params?.symbol || '').trim().toUpperCase();
      const result = await deletePosition(req.auth.user.userId, symbol);
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(404).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
      const baseCurrency = req.auth.user.baseCurrency || 'USD';
      const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
      return res.json({ netWorth: payload.netWorth, portfolio: payload.portfolio });
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dashboard/net-worth', requireAuth, async (req, res) => {
    try {
      const baseCurrency = req.auth.user.baseCurrency || 'USD';
      const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
      return res.json(payload.netWorth);
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dashboard/portfolio', requireAuth, async (req, res) => {
    try {
      const baseCurrency = req.auth.user.baseCurrency || 'USD';
      const payload = await resolveDashboardPayload(req.auth.user.userId, baseCurrency);
      return res.json(payload.portfolio);
    } catch (error) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.patch('/api/user/preferences', requireAuth, async (req, res) => {
    try {
      const baseCurrency = req.body?.baseCurrency;
      if (baseCurrency === undefined || baseCurrency === null) {
        return res.status(400).json({ message: 'baseCurrency is required.' });
      }
      const code = await updateUserBaseCurrency(req.auth.user.userId, baseCurrency);
      return res.status(200).json({ ok: true, baseCurrency: code });
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.put('/api/cash', requireAuth, async (req, res) => {
    try {
      const list = Array.isArray(req.body?.cashComponents) ? req.body.cashComponents : [];
      const normalized = list.map((item, index) => {
        const name = String(item?.name ?? `Component ${index + 1}`).trim() || 'Cash';
        const currency = String(item?.currency || 'CNY').trim().toUpperCase();
        const balance = Number(item?.balance ?? item?.amount ?? 0);
        if (!Number.isFinite(balance)) {
          throw new Error('Each cash component must have a valid balance (number).');
        }
        return { name, currency, balance };
      });
      await replaceCashComponents(req.auth.user.userId, normalized);
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.get('/api/dev/status', requireAuth, async (req, res) => {
    try {
      const positions = await listPortfolioPositions(req.auth.user.userId);
      const providerDiagnostics = await buildProviderDiagnosticsForPositions(positions);
      res.json({
        backendVersion: BACKEND_VERSION,
        storage: {
          primary: 'postgres',
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
