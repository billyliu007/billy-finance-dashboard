import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { rethrowAsBadRequest } from '../lib/mapRouteErrors.js';
import { updateUserBaseCurrency } from '../repositories/userRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

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
