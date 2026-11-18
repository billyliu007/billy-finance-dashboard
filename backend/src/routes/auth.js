import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  getErrorMessage,
  getGoogleOAuthRedirectUri,
  redirectToFrontend,
} from '../lib/requestHelpers.js';
import {
  buildAppleAuthUrl,
  buildCookieSecurityOptions,
  buildGoogleAuthUrl,
  buildMicrosoftAuthUrl,
  buildSessionCookie,
  clearSessionCookie,
  completeAppleLogin,
  completeGoogleLogin,
  completeMicrosoftLogin,
  isMicrosoftLoginConfigured,
  resolveOrCreateDemoUser,
  createUserSession,
} from '../services/authService.js';
import {
  buildOAuthStateCookie,
  clearOAuthStateCookie,
  generateOAuthState,
  isOAuthStateValid,
} from '../lib/oauthState.js';

const router = Router();

const STATE_MISMATCH_MESSAGE = 'Sign-in session expired or was started elsewhere. Please try again.';

/** Redirect to the provider after remembering a fresh `state` in a short-lived cookie. */
function redirectToProvider(res, provider, buildUrl) {
  const state = generateOAuthState();
  const url = buildUrl(state);
  res.setHeader('Set-Cookie', buildOAuthStateCookie(provider, state, buildCookieSecurityOptions()));
  return res.redirect(url);
}

/**
 * Check the returned state against the cookie and clear the cookie (one use only).
 * Returns false when the callback did not originate from a sign-in this browser started.
 */
function consumeOAuthState(req, res, provider, returnedState) {
  const valid = isOAuthStateValid(req.headers.cookie, provider, returnedState);
  res.append('Set-Cookie', clearOAuthStateCookie(provider, buildCookieSecurityOptions()));
  return valid;
}

router.get('/providers', (_req, res) => {
  res.json({
    providers: [
      { key: 'google', enabled: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID) },
      { key: 'apple', enabled: Boolean(process.env.APPLE_CLIENT_ID) },
      { key: 'microsoft', enabled: isMicrosoftLoginConfigured() },
    ],
  });
});

router.get('/google/start', (req, res) => {
  try {
    return redirectToProvider(res, 'google', (state) => buildGoogleAuthUrl(req, state));
  } catch (error) {
    // Full-page <a href> navigation: avoid raw 400 JSON (Chrome "HTTP ERROR 400").
    return redirectToFrontend(res, '/login', getErrorMessage(error), req);
  }
});

router.get('/google/callback', async (req, res) => {
  try {
    const oauthError = req.query.error ? String(req.query.error) : '';
    if (oauthError) {
      const desc = req.query.error_description
        ? String(req.query.error_description)
        : oauthError;
      return redirectToFrontend(res, '/login', desc, req);
    }
    if (!consumeOAuthState(req, res, 'google', req.query.state)) {
      return redirectToFrontend(res, '/login', STATE_MISMATCH_MESSAGE, req);
    }
    const code = String(req.query.code || '');
    if (!code) {
      return redirectToFrontend(res, '/login', 'Google authorization code missing.', req);
    }
    const redirectUri = getGoogleOAuthRedirectUri(req);
    const login = await completeGoogleLogin(code, redirectUri);
    res.append('Set-Cookie', buildSessionCookie(login.sessionToken));
    return redirectToFrontend(res, '/', null, req);
  } catch (error) {
    return redirectToFrontend(res, '/login', getErrorMessage(error), req);
  }
});

router.get('/apple/start', (req, res) => {
  try {
    return redirectToProvider(res, 'apple', (state) => buildAppleAuthUrl(state));
  } catch (error) {
    return redirectToFrontend(res, '/login', getErrorMessage(error), req);
  }
});

router.all('/apple/callback', async (req, res) => {
  try {
    const returnedState = req.query.state || req.body?.state;
    if (!consumeOAuthState(req, res, 'apple', returnedState)) {
      return redirectToFrontend(res, '/login', STATE_MISMATCH_MESSAGE, req);
    }
    const code = String(req.query.code || req.body?.code || '');
    if (!code) {
      return redirectToFrontend(res, '/login', 'Apple authorization code missing.', req);
    }
    const login = await completeAppleLogin(code);
    res.append('Set-Cookie', buildSessionCookie(login.sessionToken));
    return redirectToFrontend(res, '/', null, req);
  } catch (error) {
    return redirectToFrontend(res, '/login', getErrorMessage(error), req);
  }
});

router.get('/microsoft/start', (req, res) => {
  try {
    return redirectToProvider(res, 'microsoft', (state) => buildMicrosoftAuthUrl(state));
  } catch (error) {
    return redirectToFrontend(res, '/login', getErrorMessage(error), req);
  }
});

router.get('/microsoft/callback', async (req, res) => {
  try {
    const oauthError = req.query.error ? String(req.query.error) : '';
    if (oauthError) {
      const desc = req.query.error_description ? String(req.query.error_description) : oauthError;
      return redirectToFrontend(res, '/login', desc, req);
    }
    if (!consumeOAuthState(req, res, 'microsoft', req.query.state)) {
      return redirectToFrontend(res, '/login', STATE_MISMATCH_MESSAGE, req);
    }
    const code = String(req.query.code || '');
    if (!code) {
      return redirectToFrontend(res, '/login', 'Microsoft authorization code missing.', req);
    }
    const login = await completeMicrosoftLogin(code);
    res.append('Set-Cookie', buildSessionCookie(login.sessionToken));
    return redirectToFrontend(res, '/', null, req);
  } catch (error) {
    return redirectToFrontend(res, '/login', getErrorMessage(error), req);
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

router.post(
  '/demo',
  asyncHandler(async (_req, res) => {
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
  }),
);

export default router;
