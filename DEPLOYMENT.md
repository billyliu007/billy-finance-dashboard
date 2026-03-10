# Deployment Guide (Render + shared Postgres)

- **GitHub** – source control  
- **Render** – backend (web), frontend (static), daily snapshot (cron)  
- **Postgres** – same database used by Render and local development (schema and data already in place; no migrations run on deploy)

## 1. Connect repo in Render

1. Render Dashboard → **New +** → **Blueprint**
2. Select this repo; Render loads [`render.yaml`](render.yaml)

This creates:

| Service               | Type   | Role                          |
|-----------------------|--------|-------------------------------|
| `netpulse-backend`    | web    | API (Node), health at `/api/health` |
| `netpulse-frontend`   | static | SPA (Vite build)              |
| `netpulse-daily-snapshot` | cron | Runs at UTC midnight          |

## 2. Database

Render and local dev use the **same** database. Schema and data are already applied; **do not run migrations on deploy**.

When you add or change schema (e.g. new migration in the repo):

1. Run migrations once (e.g. from your machine or Render Shell with `DATABASE_URL` set):
   ```bash
   npm run db:migrate --prefix backend
   ```
2. Deploy as usual; no pre-deploy migration step.

## 3. Environment variables

Set secrets in a **Render Environment Group** (e.g. `netpulse-secrets`) and attach it to the backend (and cron). Configure the following.

### Backend (`netpulse-backend`)

| Variable | Required | Description |
|----------|----------|-------------|
| **Database** | | |
| `DATABASE_URL` | Yes | Postgres connection string (same as local dev). |
| `DATABASE_SSL` | No | `true` (default) or `false`. Use `true` for Neon/cloud Postgres. |
| **App & auth** | | |
| `DATA_SOURCE` | No | `db` (default). Leave as in `render.yaml`. |
| `FRONTEND_BASE_URL` | Yes | Frontend origin for CORS and redirects, e.g. `https://app.myworthtrack.com` (no trailing slash). |
| `AUTH_SESSION_TTL_MS` | No | Session lifetime in ms; default in blueprint is 14 days. |
| `MIGRATION_BIND_ENABLED` | No | `true` if you use migration bind in auth; default in blueprint. |
| `SNAPSHOT_CRON_TOKEN` | No | Secret for HTTP-triggered snapshot; optional if only using Render cron. |
| **OAuth – Google** | | |
| `GOOGLE_OAUTH_CLIENT_ID` | If using Google | From Google Cloud Console. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | If using Google | From Google Cloud Console. |
| `GOOGLE_OAUTH_CALLBACK_URL` | If using Google | `https://api.myworthtrack.com/api/auth/google/callback` (or your backend URL). |
| **OAuth – Apple** | | |
| `APPLE_CLIENT_ID` | If using Apple | From Apple Developer. |
| `APPLE_CLIENT_SECRET` | If using Apple | From Apple Developer. |
| `APPLE_CALLBACK_URL` | If using Apple | `https://api.myworthtrack.com/api/auth/apple/callback`. |
| **OAuth – WeChat** | | |
| `WECHAT_APP_ID` | If using WeChat | From WeChat. |
| `WECHAT_APP_SECRET` | If using WeChat | From WeChat. |
| `WECHAT_CALLBACK_URL` | If using WeChat | `https://api.myworthtrack.com/api/auth/wechat/callback`. |
| **Market data** | | |
| `FINNHUB_API_KEY` | Yes (for stocks) | From Finnhub. |
| `FX_PROVIDER` | No | `frankfurter` (default in blueprint). |
| `CRYPTO_PROVIDER` | No | `coinbase` (default in blueprint). |

Optional: `PORTFOLIO_CONFIG_JSON` (JSON string) for portfolio config overrides.

### Frontend (`netpulse-frontend`)

Defined in `render.yaml`; override in Render only if needed:

| Variable | Value | Description |
|----------|--------|-------------|
| `VITE_API_BASE_URL` | `https://api.myworthtrack.com` | Backend API base URL (baked in at build time). |
| `VITE_SHOW_DEVELOPMENT_PAGE` | `false` | Set `true` to show dev/debug page. |

### Cron (`netpulse-daily-snapshot`)

Uses same DB and market-data env; no OAuth or frontend URL. From group or service:

- `DATABASE_URL`, `DATABASE_SSL`, `DATA_SOURCE`
- `FINNHUB_API_KEY`, `FX_PROVIDER`, `CRYPTO_PROVIDER`

## 4. OAuth callback URLs

In each provider’s console, set the callback URL to your **backend** domain:

- Google: `https://api.myworthtrack.com/api/auth/google/callback`
- Apple: `https://api.myworthtrack.com/api/auth/apple/callback`
- WeChat: `https://api.myworthtrack.com/api/auth/wechat/callback`

## 5. Custom domains (optional)

- **Frontend:** e.g. `app.myworthtrack.com` → point to `netpulse-frontend` on Render.
- **Backend:** e.g. `api.myworthtrack.com` → point to `netpulse-backend` on Render.

Ensure `FRONTEND_BASE_URL` and `VITE_API_BASE_URL` match the URLs you use (see `render.yaml` and frontend env above).

## 6. Daily snapshot cron

- **Schedule:** `0 0 * * *` (UTC midnight).
- **Command:** `npm run cron:daily-snapshot --prefix backend` (writes net worth history to the shared DB).

No pre-deploy command is configured; the database is shared with local dev and is not migrated on deploy.

## 7. Performance (production load)

To keep app load fast and reliable in production:

- **Single dashboard request** – The frontend calls `GET /api/dashboard` once after login. That endpoint returns both `netWorth` and `portfolio` in one response. Net Worth and Portfolio pages share this data, so switching tabs does not trigger another heavy request.
- **One FX request** – The backend fetches all FX rates (e.g. USD, EUR, SGD → CNY) in a single Frankfurter API call instead of one call per currency.
- **Timeouts on external APIs** – Outbound requests to Frankfurter, Finnhub, and crypto providers (Coinbase, etc.) use a 10s timeout. If a provider is slow or down, the request fails that part instead of hanging the whole dashboard.
- **Cold starts** – On Render’s free tier the backend can spin down when idle; the first request after that may be slow. Use a paid plan or a keep-alive ping to reduce cold starts.
