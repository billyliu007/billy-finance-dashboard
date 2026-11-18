import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ApiError } from '../lib/ApiError.js';
import {
  buildPasskeyChallengeCookie,
  clearPasskeyChallengeCookie,
  defaultPasskeyName,
  readPasskeyChallenge,
} from '../lib/passkeyConfig.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  buildCookieSecurityOptions,
  buildSessionCookie,
  createUserSession,
} from '../services/authService.js';
import { createPasskeyService } from '../services/passkeyService.js';

/** Mounted at /api/auth/passkey */
const router = Router();
const passkeys = createPasskeyService({ createSession: createUserSession });

/** Passkeys can only be managed from a signed-in browser session, not with an API token. */
function requireBrowserSession(req, _res, next) {
  if (req.auth?.apiTokenId || !req.auth?.token) {
    return next(new ApiError('Manage passkeys from the website while signed in.', 403));
  }
  return next();
}

/** Read and clear the challenge cookie for this ceremony (one use only). */
function takeChallenge(req, res, purpose) {
  const challenge = readPasskeyChallenge(req.headers.cookie, purpose);
  res.append('Set-Cookie', clearPasskeyChallengeCookie(purpose, buildCookieSecurityOptions()));
  return challenge;
}

// --- Add a passkey to the signed-in account ------------------------------------------------

router.post(
  '/register/options',
  requireAuth,
  requireBrowserSession,
  asyncHandler(async (req, res) => {
    const { options, challenge } = await passkeys.registrationOptions(req.auth.user);
    res.append('Set-Cookie', buildPasskeyChallengeCookie('register', challenge, buildCookieSecurityOptions()));
    return res.json(options);
  }),
);

router.post(
  '/register/verify',
  requireAuth,
  requireBrowserSession,
  asyncHandler(async (req, res) => {
    const expectedChallenge = takeChallenge(req, res, 'register');
    const passkey = await passkeys.verifyRegistration({
      user: req.auth.user,
      response: req.body?.response,
      expectedChallenge,
      name: req.body?.name || defaultPasskeyName(req.headers['user-agent']),
    });
    return res.status(201).json({ passkey });
  }),
);

// --- Sign in with a passkey ----------------------------------------------------------------

router.post(
  '/login/options',
  asyncHandler(async (_req, res) => {
    const { options, challenge } = await passkeys.authenticationOptions();
    res.append('Set-Cookie', buildPasskeyChallengeCookie('login', challenge, buildCookieSecurityOptions()));
    return res.json(options);
  }),
);

router.post(
  '/login/verify',
  asyncHandler(async (req, res) => {
    const expectedChallenge = takeChallenge(req, res, 'login');
    const { sessionToken } = await passkeys.verifyAuthentication({
      response: req.body?.response,
      expectedChallenge,
    });
    res.append('Set-Cookie', buildSessionCookie(sessionToken));
    return res.json({ authenticated: true });
  }),
);

// --- List / remove the signed-in user's passkeys -------------------------------------------

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({ passkeys: await passkeys.listForUser(req.auth.user) });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requireBrowserSession,
  asyncHandler(async (req, res) => {
    return res.json(await passkeys.removeForUser(req.auth.user, req.params.id));
  }),
);

export default router;
