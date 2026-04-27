import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { rethrowAsBadRequest } from '../lib/mapRouteErrors.js';
import { listCashComponents } from '../repositories/cashRepository.js';
import { listNetWorthHistory } from '../repositories/netWorthHistoryRepository.js';
import { listAllPositionTransactions, listPortfolioPositions } from '../repositories/portfolioRepository.js';
import {
  buildSettingsExportPayload,
  importSettingsDataReplaceAll,
} from '../services/settingsDataTransferService.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const userId = req.auth.user.userId;
    const [cashRows, netWorthRows, holdingsRows, transactionRows] = await Promise.all([
      listCashComponents(userId),
      listNetWorthHistory(userId),
      listPortfolioPositions(userId),
      listAllPositionTransactions(userId),
    ]);
    const backup = buildSettingsExportPayload({ cashRows, netWorthRows, holdingsRows, transactionRows });
    return res.status(200).json(backup);
  }),
);

router.post(
  '/import',
  asyncHandler(async (req, res) => {
    try {
      const result = await importSettingsDataReplaceAll({
        userId: req.auth.user.userId,
        backup: req.body,
      });
      return res.status(200).json(result);
    } catch (error) {
      rethrowAsBadRequest(error);
    }
  }),
);

export default router;
