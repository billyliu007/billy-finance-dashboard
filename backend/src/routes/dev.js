import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { listPortfolioPositions } from '../repositories/financeRepository.js';
import { buildProviderDiagnosticsForPositions } from '../services/marketDataService.js';
import { requireAuth } from '../middleware/requireAuth.js';

function resolveBackendVersion() {
  try {
    const raw = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed?.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

const router = Router();
router.use(requireAuth);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const positions = await listPortfolioPositions(req.auth.user.userId);
    const providerDiagnostics = await buildProviderDiagnosticsForPositions(positions);
    res.json({
      backendVersion: resolveBackendVersion(),
      storage: {
        primary: 'postgres',
        userScoped: true,
      },
      auth: {
        providers: {
          google: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
          apple: Boolean(process.env.APPLE_CLIENT_ID),
        },
        onboardingCompleted: req.auth.user.onboardingCompleted,
      },
      providerDiagnostics,
    });
  }),
);

export default router;
