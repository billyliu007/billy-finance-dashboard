import authRouter from './auth.js';
import onboardingRouter from './onboarding.js';
import marketRouter from './market.js';
import portfolioRouter from './portfolio.js';
import dashboardRouter from './dashboard.js';
import userRouter from './user.js';
import cashRouter from './cash.js';
import currenciesRouter from './currencies.js';
import internalRouter from './internal.js';
import devRouter from './dev.js';
import profitabilityRouter from './profitability.js';

export function mountRoutes(app) {
  app.use('/api/auth', authRouter);
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/market', marketRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/trading-performance', profitabilityRouter);
  app.use('/api/profitability', profitabilityRouter);
  app.use('/api/user', userRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/currencies', currenciesRouter);
  app.use('/api/internal', internalRouter);
  app.use('/api/dev', devRouter);
}
