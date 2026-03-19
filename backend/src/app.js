import express from 'express';
import cors from 'cors';
import { getErrorMessage } from './lib/requestHelpers.js';
import { resolveSessionFromRequest } from './services/authService.js';
import { mountRoutes } from './routes/index.js';

export default function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (origin, cb) => cb(null, origin || true),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(async (req, _res, next) => {
    try {
      req.auth = await resolveSessionFromRequest(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  mountRoutes(app);

  app.use((err, _req, res, _next) => {
    const status = err.statusCode ?? 500;
    res.status(status).json({ message: getErrorMessage(err) });
  });

  return app;
}
