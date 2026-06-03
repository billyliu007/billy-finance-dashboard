# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**My Worth Track** — a multi-user personal finance dashboard (net worth, portfolio holdings, live market data). Monorepo with an Express + PostgreSQL `backend` and a React (Vite) `frontend`. Note the npm package name is `google-sheets-fullstack` for historical reasons (it migrated off Google Sheets; see `docs/MIGRATION_OFF_SHEETS.md`).

## Commands

All commands run from the repo root unless noted.

```bash
npm run setup          # install root + backend + frontend deps
npm run dev            # run backend (:4000) and frontend (:5173) concurrently
npm run dev:backend    # backend only (node --watch)
npm run dev:frontend   # frontend only (Vite)
npm run db:migrate     # apply DB schema migrations (run after pulling schema changes / fresh DB)
npm run build          # build frontend
npm test               # backend unit tests (node --test)
```

Frontend lint: `npm run lint --prefix frontend` (ESLint).

**Run a single backend test:** `node --test backend/tests/netWorthService.test.js` (or filter within a file with `--test-name-pattern "<substring>"`). Tests use the built-in `node:test` + `node:assert/strict` and are pure-unit (mocked inputs, **no live DB** required).

Useful backend scripts (all via `--prefix backend`): `cron:daily-snapshot`, `db:sync-coinbase-products`, `db:sync-us-stock-symbols`, `admin:reset-demo`, `admin:delete-incomplete-onboarding`.

Before running locally, copy env templates: `cp backend/.env.example backend/.env` and `cp frontend/.env.example frontend/.env`.

## Backend architecture

Strict layering — keep concerns in their layer:

```
routes/*  →  services/*  →  repositories/*  →  PostgreSQL (pg Pool)
            (lib/* pure helpers used by all layers)
```

- **`routes/`** — HTTP only: validation, call a service, shape the response. Mounted centrally in `routes/index.js` (`mountRoutes(app)`). Wrap async handlers in `asyncHandler` (`lib/asyncHandler.js`) so rejections reach the global error middleware in `app.js`.
- **`services/`** — business logic, aggregation, external API calls (Finnhub / Coinbase / FX). No raw SQL here.
- **`repositories/`** — **SQL only**, always parameterized (`$1`, `$2`). `financeRepository.js` is a barrel re-exporting domain repos. DB access via `db/client.js` helpers: `query(text, params)` (single statement), `withTransaction(task)` (BEGIN/COMMIT/ROLLBACK — use for all multi-statement atomic work), `withDbClient(task)` (client without a transaction).
- **`lib/`** — pure, dependency-light helpers (FX, crypto, price resolution, http).

**Errors:** throw `new ApiError(message, statusCode)` (`lib/ApiError.js`); the global handler in `app.js` reads `err.statusCode` and serializes `{ message }`. Use `mapRouteErrors.js` helpers (e.g. `rethrowAsBadRequest`) to normalize lower-layer errors.

**Auth:** a top-level middleware in `app.js` calls `resolveSessionFromRequest` and sets `req.auth` for every request; routes opt into protection with the `requireAuth` middleware. Sessions use the `bf_session` cookie; external API clients (`/api/v1/*`) authenticate via bearer API tokens. Cookie `Secure`/`SameSite` behavior depends on `NODE_ENV` and `FRONTEND_BASE_URL` (see `authService.js`). Set `TRUST_PROXY=1` behind TLS terminators so OAuth `redirect_uri` is correct.

**Database is PostgreSQL via `pg` `Pool` (singleton).** Do **not** switch to the Neon serverless driver — this backend runs as a long-lived process (local, Render web, Render cron) and should keep the connection pool. Tune with `PGPOOL_MAX`; SSL is driven by `DATABASE_SSL`. Migrations are **manual** (`db/migrate.js`, schema in `backend/db/schema.sql`).

## Frontend architecture

React 19 + React Router 7 + Recharts, Vite build. In dev, Vite proxies `/api` → `http://localhost:4000` (see `vite.config.js`); the API base also comes from `constants.js` (`API_BASE_URL`).

- **`contexts/DashboardContext.jsx`** holds a single `GET /api/dashboard` payload (`netWorth`, `portfolio`, `fxRates`, …) shared across pages. It polls ~60s while the tab is visible and refetches on visibility change; `refresh()` bumps a nonce to refetch (supports a *silent* mode to avoid full-page loading flashes). Prefer reading from this context over adding new dashboard slice endpoints.
- **`contexts/LanguageContext.jsx`** — i18n with `t(key, vars)`; supported languages are `en` and `zh` (strings in `i18n/translations.js`).
- **`contexts/ToastContext.jsx`** — surface mutation/delete errors via toasts.
- **`utils/api.js`** — `fetchJson` / `postJson` wrappers; always send `credentials: 'include'` and parse `{ message }` error bodies.
- Pages live in `pages/`; the **Trading Performance / Profitability** page uses only `GET /api/trading-performance` and does **not** use `DashboardContext`.

## Key data-flow conventions

- **USD is the canonical aggregation/storage currency.** Net worth and portfolio aggregates are USD-normalized (`pnlUsd`, `total_usd`); a user's display `base_currency` is for presentation, **not** snapshot math. The daily snapshot also stores `total_cny` (derived from the FX map, `NULL` if the CNY pivot is unavailable — never fabricated).
- **One dashboard payload:** `GET /api/dashboard` returns net worth + portfolio + benchmarks together; positions/quotes are loaded once and shared. The legacy `/api/dashboard/net-worth`, `/api/dashboard/portfolio`, and `/api/profitability` routes were **intentionally removed** — use `/api/dashboard` and `/api/trading-performance`.
- **Market data fallback chains:** stocks via Finnhub; crypto Coinbase → CoinGecko → Binance; FX Frankfurter → `open.er-api` (disable secondary with `FX_PROVIDER_FALLBACK=none`).
- **Daily snapshot cron** (`scripts/runDailySnapshot.js` → `snapshotService.js`) runs 00:00 UTC, must use the **same holdings math as the dashboard** (`applyTransactionAggregatesToPositions`), and writes `networth_history` + `fx_daily_rates`. Trigger manually with `npm run cron:daily-snapshot --prefix backend` (optional `SNAPSHOT_DATE_UTC`) or `POST /api/internal/snapshot/daily` with header `x-cron-token`.

## Documentation map

Deep-dive docs live in `docs/` — consult before non-trivial changes:

- `ARCHITECTURE.md` — layering, DB/Neon rationale, frontend state, config alignment.
- `CALCULATIONS_TOTALS_AND_NET_WORTH.md` / `PORTFOLIO_MARKET_PRICE.md` / `CURRENCY_AND_CRYPTO_LOGIC.md` — valuation math, pricing, FX/crypto rules.
- `CRON_DAILY_SNAPSHOT.md` — snapshot job behavior and storage contract.
- `EXTERNAL_API_V1.md` — the `/api/v1/*` token-authenticated external API.
- `GOOGLE_OAUTH.md` / `APPLE_LOGIN.md` — OAuth provider setup.
- `OPTIMIZATION_AND_REFACTOR.md` — perf/DRY backlog and what's already implemented.
- Deployment: `DEPLOYMENT.md` + `render.yaml` (Render blueprint: web backend, static frontend, cron). Treat the Render env group as the source of truth for secrets.

## MCP server

The WorthTrack MCP server lives in `mcp-server/worthtrack.py`. It wraps the `/api/v1/` external API for use with Claude Desktop (stdio transport). Configure via env vars:
- `WORTHTRACK_API_TOKEN` — a `bfpat_` personal access token (create via Settings page)
- `WORTHTRACK_API_BASE_URL` — defaults to `https://api.myworthtrack.com`

## CI

`.github/workflows/ci.yml` runs on push/PR to `main`: backend unit tests (`npm test --prefix backend`) and a frontend build. CI does not run DB-backed tests, so keep backend tests pure-unit / mocked.
