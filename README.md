# Billy Finance Dashboard (Google Sheets powered)

A personal finance dashboard that reads your data from **Google Sheets** and renders:
- **Net Worth** (summary + performance over time)
- **Portfolio holdings** (positions + allocation + P&L)
- **Privacy mode** toggle (hide amounts)

This repo is a full-stack app:
- `backend`: Express API that reads Google Sheets via a service account.
- `frontend`: React (Vite) UI that calls the backend.

## Run locally

### 1) Install dependencies

```bash
npm run setup
```

### 2) Configure backend environment

```bash
cp backend/.env.example backend/.env
```

Set these in `backend/.env`:
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (single-line value with escaped `\n`)

Example private key format:

```env
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n"
```

### 3) Share sheet access

Share your Google Sheet with the **service account email** as **Viewer**.

### 4) Start the app

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Google Sheet expectations

The backend reads multiple ranges (see `backend/src/config/dashboardConfig.js` and `backend/src/config/portfolioConfig.js`).
By default it expects sheet tabs like:
- `Net Worth`
- `Forex`
- `Crypto/Stock Portfolio`
- `Cashflow`

## API

The frontend uses these endpoints:
- `GET /api/health` (health check)
- `GET /api/dashboard/net-worth` (net worth + performance payload)
- `GET /api/dashboard/portfolio` (portfolio payload)

Raw sheet endpoints (useful for debugging):
- `GET /api/sheet?range=<A1_RANGE>`
- `GET /api/sheets?ranges=<A1_RANGE>,<A1_RANGE>,...`

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`render.yaml`](render.yaml).
