import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { rethrowAsBadRequest } from '../lib/mapRouteErrors.js';
import {
  createUserApiToken,
  listUserApiTokens,
  revokeUserApiToken,
} from '../repositories/apiTokenRepository.js';
import { updateUserBaseCurrency } from '../repositories/userRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.post(
  '/api-tokens',
  asyncHandler(async (req, res) => {
    try {
      const label = req.body?.label;
      const expiresAt = req.body?.expiresAt ?? null;
      const created = await createUserApiToken(req.auth.user.userId, { label, expiresAt });
      return res.status(201).json(created);
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

router.get(
  '/api-tokens',
  asyncHandler(async (req, res) => {
    const tokens = await listUserApiTokens(req.auth.user.userId);
    return res.status(200).json({ tokens });
  }),
);

router.delete(
  '/api-tokens/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params?.id || '').trim();
    const ok = await revokeUserApiToken(req.auth.user.userId, id);
    if (!ok) {
      return res.status(404).json({ message: 'Token not found or already revoked.' });
    }
    return res.status(200).json({ ok: true });
  }),
);

router.patch(
  '/preferences',
  asyncHandler(async (req, res) => {
    const baseCurrency = req.body?.baseCurrency;
    if (baseCurrency === undefined || baseCurrency === null) {
      return res.status(400).json({ message: 'baseCurrency is required.' });
    }
    try {
      const code = await updateUserBaseCurrency(req.auth.user.userId, baseCurrency);
      return res.status(200).json({ ok: true, baseCurrency: code });
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

export default router;
