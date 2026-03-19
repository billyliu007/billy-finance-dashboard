import { Router } from 'express';
import { getErrorMessage, redirectToFrontend } from '../lib/requestHelpers.js';
import { ApiError } from '../lib/ApiError.js';
import {
  buildAppleAuthUrl,
  buildGoogleAuthUrl,
  buildSessionCookie,
  clearSessionCookie,
  completeAppleLogin,
  completeGoogleLogin,
  resolveOrCreateDemoUser,
  createUserSession,
} from '../services/authService.js';

const router = Router();

router.get('/providers', (_req, res) => {
  res.json({
    providers: [
      { key: 'google', enabled: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID) },
      { key: 'apple', enabled: Boolean(process.env.APPLE_CLIENT_ID) },
    ],
  });
});

router.get('/google/start', (_req, res, next) => {
  try {
    return res.redirect(buildGoogleAuthUrl());
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.get('/google/callback', async (req, res) => {
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

router.get('/apple/start', (_req, res, next) => {
  try {
    return res.redirect(buildAppleAuthUrl());
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

router.all('/apple/callback', async (req, res) => {
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

router.get('/session', (req, res) => {
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

router.post('/logout', async (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.status(200).json({ ok: true });
});

router.post('/demo', async (_req, res, next) => {
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
    next(new ApiError(getErrorMessage(error), 500));
  }
});

export default router;
