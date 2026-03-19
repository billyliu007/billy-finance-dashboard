# My Worth Track

A personal finance dashboard with multi-user support (net worth, portfolio holdings, live market data).

## Core capabilities

- User-scoped finance data in Postgres
- OAuth login providers:
  - Google
  - Apple
- First-login onboarding (initial cash/debt/assets)
- Live market data:
  - Stocks: Finnhub
  - Crypto: Coinbase -> CoinGecko -> Binance fallback
  - FX: Frankfurter
- Daily net-worth snapshot job (UTC 00:00)

## Stack

- `backend`: Express API + PostgreSQL
- `frontend`: React (Vite)

## Local development

### 1) Install dependencies

```bash
npm run setup
```

### 2) Configure environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Set required backend values in `backend/.env`:

- `DATABASE_URL`
- `FRONTEND_BASE_URL`
- OAuth credentials:
  - `GOOGLE_OAUTH_*`
  - `APPLE_*`
- market data keys/settings:
  - `FINNHUB_API_KEY`
  - `FX_PROVIDER`
  - `CRYPTO_PROVIDER`

### 3) Run DB schema migration

```bash
npm run db:migrate
```

(Runs the backend migration script; apply after pulling schema changes or when using a fresh DB.)

### 4) Start app

```bash
npm run dev
```

- Frontend: `http://localhost:5173` (if 5173 is in use, Vite may use the next port, e.g. 5174)
- Backend: `http://localhost:4000`

## Authentication + onboarding flow

1. Open frontend and sign in via OAuth provider.
2. If first login, complete onboarding:
   - preferred display name
   - initial cash/debt rows
   - initial asset positions
3. Dashboard routes unlock after onboarding completes.

## API (main)

- `GET /api/health`
- `GET /api/auth/session`, `POST /api/auth/logout`
- `GET /api/auth/providers`, `GET /api/auth/{google,apple}/start`, `GET /api/auth/{google,apple}/callback`
- `GET /api/dashboard/net-worth`, `GET /api/dashboard/portfolio`
- `GET /api/market/coinbase-products`, `GET /api/market/us-stock-symbols`
- `POST /api/portfolio/positions/crypto`, `POST /api/portfolio/positions/stock`
- `GET /api/onboarding/status`, `POST /api/onboarding/initialize`
- `GET /api/dev/status`

Cron/internal:

- `POST /api/internal/snapshot/daily` (requires `x-cron-token`)

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`render.yaml`](render.yaml).
