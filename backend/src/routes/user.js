import { Router } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { getErrorMessage } from '../lib/requestHelpers.js';
import { updateUserBaseCurrency } from '../repositories/userRepository.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.patch('/preferences', async (req, res, next) => {
  try {
    const baseCurrency = req.body?.baseCurrency;
    if (baseCurrency === undefined || baseCurrency === null) {
      return res.status(400).json({ message: 'baseCurrency is required.' });
    }
    const code = await updateUserBaseCurrency(req.auth.user.userId, baseCurrency);
    return res.status(200).json({ ok: true, baseCurrency: code });
  } catch (error) {
    next(new ApiError(getErrorMessage(error), 400));
  }
});

export default router;
