# Deployment Guide (Render + External Postgres)

This project is designed for:

- GitHub for source control
- Render for backend/frontend hosting
- External free Postgres (e.g. Neon/Supabase) via `DATABASE_URL`

## 1) Connect repo in Render

1. Render dashboard -> **New +** -> **Blueprint**
2. Select this repo
3. Render loads [`render.yaml`](render.yaml)

It creates:

- `netpulse-backend` (web)
- `netpulse-frontend` (static)
- `netpulse-daily-snapshot` (cron)

## 2) Configure backend env vars

Set on backend service (or env group):

- `DATABASE_URL`
- `FRONTEND_BASE_URL`
- `DATABASE_SSL` (default `true`)
- `AUTH_SESSION_TTL_MS`
- `SNAPSHOT_CRON_TOKEN`
- `MIGRATION_BIND_ENABLED`
- `FINNHUB_API_KEY`
- `FX_PROVIDER`
- `CRYPTO_PROVIDER`

OAuth credentials:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_CALLBACK_URL`
- `APPLE_CLIENT_ID`
- `APPLE_CLIENT_SECRET`
- `APPLE_CALLBACK_URL`
- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_CALLBACK_URL`

## 3) Configure frontend env var

Set on frontend static service:

- `VITE_API_BASE_URL=https://<your-backend>.onrender.com`

## 4) Database schema migration

On Render, migrations run automatically before each deploy via `preDeployCommand` in `render.yaml`. For local or first-time setup, run once:

```bash
npm run db:migrate --prefix backend
```

## 5) Daily snapshot cron

`render.yaml` config schedules snapshot at UTC midnight:

- schedule: `0 0 * * *`
- command: `npm run cron:daily-snapshot --prefix backend`

## 6) OAuth callback URLs

In each OAuth provider console, configure callback URLs to match backend public domain:

- Google: `https://<backend>/api/auth/google/callback`
- Apple: `https://<backend>/api/auth/apple/callback`
- WeChat: `https://<backend>/api/auth/wechat/callback`
