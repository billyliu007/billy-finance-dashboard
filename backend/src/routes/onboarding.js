import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { parseOnboardingPayload } from '../lib/onboardingPayload.js';
import {
  listCashComponents,
  listPortfolioPositions,
  replaceCashComponents,
  replacePortfolioPositions,
} from '../repositories/financeRepository.js';
import { markOnboardingCompleted } from '../repositories/userRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get('/status', async (req, res) => {
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

router.post('/initialize', async (req, res, next) => {
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
    next(new ApiError(error?.message || 'Bad request', 400));
  }
});

router.post('/complete', async (req, res, next) => {
  try {
    const userId = req.auth.user.userId;
    const rawName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const displayName = rawName || req.auth.user.displayName || null;
    const updatedUser = await markOnboardingCompleted(userId, displayName);
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
    next(new ApiError(error?.message || 'Bad request', 400));
  }
});

export default router;
