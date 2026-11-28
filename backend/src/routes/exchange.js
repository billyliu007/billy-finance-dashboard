import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ApiError } from '../lib/ApiError.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createExchangeSyncService } from '../services/exchangeSyncService.js';

/** Mounted at /api/exchange */
const router = Router();
router.use(requireAuth);
const service = createExchangeSyncService();

/** Exchange keys can only be added or removed from a signed-in browser session, not with an API token. */
function requireBrowserSession(req, _res, next) {
  if (req.auth?.apiTokenId || !req.auth?.token) {
    return next(new ApiError('Manage exchange keys from the website while signed in.', 403));
  }
  return next();
}

router.get(
  '/connections',
  asyncHandler(async (req, res) => {
    res.json({ connections: await service.listConnections(req.auth.user.userId) });
  }),
);

router.post(
  '/connections',
  requireBrowserSession,
  asyncHandler(async (req, res) => {
    const connection = await service.connect(req.auth.user.userId, req.body || {});
    res.status(201).json({ ok: true, connection });
  }),
);

router.delete(
  '/connections/:exchange',
  requireBrowserSession,
  asyncHandler(async (req, res) => {
    res.json(await service.disconnect(req.auth.user.userId, req.params.exchange));
  }),
);

router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const userId = req.auth.user.userId;
    const days = req.body?.days ?? req.query?.days;
    const sync = await service.sync(userId, { days, force: Boolean(req.body?.force) });
    const list = await service.listTrades(userId, { days });
    res.json({ ...list, sync: sync.results });
  }),
);

router.get(
  '/trades',
  asyncHandler(async (req, res) => {
    res.json(await service.listTrades(req.auth.user.userId, { days: req.query?.days }));
  }),
);

router.post(
  '/trades/:id/add',
  asyncHandler(async (req, res) => {
    res.json(await service.add(req.auth.user.userId, req.params.id, req.body || {}));
  }),
);

router.post(
  '/trades/:id/ignore',
  asyncHandler(async (req, res) => {
    res.json(await service.ignore(req.auth.user.userId, req.params.id));
  }),
);

router.post(
  '/trades/:id/restore',
  asyncHandler(async (req, res) => {
    res.json(await service.restore(req.auth.user.userId, req.params.id));
  }),
);

router.post(
  '/plans/:id/apply',
  asyncHandler(async (req, res) => {
    res.json(await service.applyPlan(req.auth.user.userId, req.params.id, req.body || {}));
  }),
);

router.post(
  '/plans/:id/ignore',
  asyncHandler(async (req, res) => {
    res.json(await service.ignorePlan(req.auth.user.userId, req.params.id, true));
  }),
);

router.post(
  '/plans/:id/restore',
  asyncHandler(async (req, res) => {
    res.json(await service.ignorePlan(req.auth.user.userId, req.params.id, false));
  }),
);

export default router;
