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

**Architecture & DB (Neon, layers, dashboard state):** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · **Refactors / perf backlog:** [`docs/OPTIMIZATION_AND_REFACTOR.md`](docs/OPTIMIZATION_AND_REFACTOR.md)

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
  - `GOOGLE_OAUTH_*` — step-by-step: [`docs/GOOGLE_OAUTH.md`](docs/GOOGLE_OAUTH.md)
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
- `GET /api/dashboard` (net worth + portfolio + benchmarks in one payload)
- `GET /api/trading-performance` (optional `?from=&to=&symbol=`) — JSON for the Trading Performance page: **DB only** (minimal holdings metadata for `portfolioIsEmpty` / attribution + filtered position transactions). **No** live quotes or FX. Query `symbol` (uppercased ticker) scopes all aggregates and series to **SELL** rows for that symbol only; response includes `scope: { symbol }`, `availableSymbols` (sorted tickers with at least one SELL in the date range), and when scoped: `summary.asset` (totals and volume-weighted per-unit averages), `trades.details` (all sells for the symbol, chronological), and empty `trades.best` / `trades.worst`. Unscoped fields: `portfolioIsEmpty`, `range`, `summary`, `timeSeries.monthlyStacked`, `realizedAttribution`, `trades`. Aggregates are **USD-normalized** (`pnlUsd`); UI uses USD formatting. Per-trade rows use listing currency + `pnlUsd`.
- `GET /api/market/coinbase-products`, `GET /api/market/us-stock-symbols`
- `POST /api/portfolio/positions/crypto`, `POST /api/portfolio/positions/stock`
- `GET /api/onboarding/status`, `POST /api/onboarding/initialize`
- `GET /api/dev/status`

Cron/internal:

- `POST /api/internal/snapshot/daily` (requires `x-cron-token`)

## CI

On push/PR to `main`, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs backend unit tests (`npm test --prefix backend`) and builds the frontend.

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`render.yaml`](render.yaml).
