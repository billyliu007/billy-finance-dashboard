# NetPulse (Postgres + OAuth)

A personal finance dashboard with multi-user support.

## Core capabilities

- User-scoped finance data in Postgres
- OAuth login providers:
  - Google
  - Apple
  - WeChat
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
  - `WECHAT_*`
- market data keys/settings:
  - `FINNHUB_API_KEY`
  - `FX_PROVIDER`
  - `CRYPTO_PROVIDER`

### 3) Run DB schema migration

```bash
npm run db:migrate --prefix backend
```

### 4) Start app

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
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
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/dashboard/net-worth`
- `GET /api/dashboard/portfolio`
- `GET /api/dev/status`
- `GET /api/onboarding/status`
- `POST /api/onboarding/initialize`

Cron/internal:

- `POST /api/internal/snapshot/daily` (requires `x-cron-token`)

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`render.yaml`](render.yaml).
