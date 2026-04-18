# External API v1 (consumer guide)

This document describes the **read-only HTTP API** for accessing your own net worth, cash, holdings, and position transactions. All paths are relative to your **backend base URL** — see [Base URL](#base-url) below.

## Base URL

Send API requests to the **backend** origin. The read API (`/api/v1/...`), token management (`/api/user/api-tokens`), and health check (`/api/health`) all live on that host. **Do not** use the web app URL as `$BASE` for scripts or integrations; the hosted frontend does not serve these API routes.

| Environment | Base URL (`$BASE`, no trailing slash) | Notes |
|-------------|--------------------------------------|--------|
| **My Worth Track (production)** | `https://api.myworthtrack.com` | Use for all `curl`, server-side jobs, and mobile backends. |
| **My Worth Track (web app)** | `https://app.myworthtrack.com` | Browser UI only — sign in and open **Settings** to create PATs. |
| **Local development** | `http://localhost:4000` | Typical default; match your running backend port. |

**Examples (production):**

- Net worth: `https://api.myworthtrack.com/api/v1/me/net-worth`
- Cash: `https://api.myworthtrack.com/api/v1/me/cash`
- Scenario plan (active): `https://api.myworthtrack.com/api/v1/me/scenario-plan`
- Create/list/revoke PATs: `https://api.myworthtrack.com/api/user/api-tokens`

Self-hosted deployments use your own API hostname; see [`DEPLOYMENT.md`](../DEPLOYMENT.md) for environment variables such as `VITE_API_BASE_URL` and `FRONTEND_BASE_URL`.

## Status

Implementation is complete: migration `20260411_user_api_tokens.sql`, routes under `/api/v1`, and PAT management under `/api/user/api-tokens`. In the web app, open the **user menu (avatar) → Settings** to create, list, and revoke API keys without using curl.

Apply database migrations and set `API_TOKEN_PEPPER` in production before issuing tokens (see [`backend/.env.example`](../backend/.env.example)).

---

## Authentication

Every `/api/v1/...` request must identify **your user account**. Use one of the following.

### Recommended: Personal Access Token (PAT)

1. Sign in to the web app with your normal login (for example Google) so the browser has a session cookie.
2. Create a PAT: use **Settings** in the user menu, or call the HTTP API (see [Token management](#token-management) below). The server returns **`token` exactly once** — copy it immediately and store it securely (password manager, secret env var, etc.).
3. On each API call, send:

```http
Authorization: Bearer bfpat_<secret>
```

Tokens are opaque strings prefixed with `bfpat_`. They are **secrets**: do not commit them to git, log them, or put them in client-side web pages.

### Optional: Browser session token as Bearer

If you already have a valid **session token** (the same value the server stores in the `bf_session` cookie), you can send:

```http
Authorization: Bearer <64-character-hex-session-token>
```

Session tokens expire per `AUTH_SESSION_TTL_MS` and are intended for the web app; PATs are better for scripts and long-lived automation.

### Cookie session

If your client sends cookies (for example a browser on the same site as the API with `credentials: 'include'`), a valid `bf_session` cookie is enough and `Authorization` is not required.

### Unauthorized responses

Missing or invalid authentication returns **`401`** with a JSON body such as:

```json
{ "message": "Authentication required." }
```

Other errors use **`4xx`/`5xx`** with `{ "message": "..." }` unless noted otherwise.

---

## Token management

These endpoints require an **existing authenticated session** (cookie or Bearer session/PAT). They are **not** part of the read-only v1 surface; they manage PATs themselves.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/user/api-tokens` | Create a PAT. |
| `GET` | `/api/user/api-tokens` | List your tokens (metadata only; no secret). |
| `DELETE` | `/api/user/api-tokens/:id` | Revoke a token by id (from the list response). |

### Create token

**Request body (JSON, optional fields):**

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Optional human-readable label (max 200 characters). |
| `expiresAt` | string \| null | Optional ISO 8601 datetime; must be in the future if set. |

**Response `201`:** includes `id`, `token` (**show once**), `label`, `createdAt`, `expiresAt`.

**Example (curl with session cookie):**

```bash
curl -sS -X POST "$BASE/api/user/api-tokens" \
  -H "Content-Type: application/json" \
  -H "Cookie: bf_session=YOUR_SESSION_TOKEN" \
  -d '{"label":"My script"}'
```

### List tokens

**Response `200`:** `{ "tokens": [ { "id", "label", "createdAt", "lastUsedAt", "expiresAt", "revokedAt" }, ... ] }`

Revoked tokens may still appear with `revokedAt` set.

### Revoke token

**Response `200`:** `{ "ok": true }`  
**Response `404`:** token not found or already revoked.

---

## Read API base path

All read endpoints:

- Base path: **`/api/v1`**
- Methods: **`GET` only**
- Auth: session cookie **or** `Authorization: Bearer ...` (PAT or session token)

**Example:**

```bash
export TOKEN='bfpat_...'
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/me/net-worth"
```

---

## Endpoints

### `GET /api/v1/me/net-worth`

Net worth and component breakdown in **USD** (same computation path as the dashboard with base currency forced to USD).

**Response (JSON):**

| Field | Description |
|-------|-------------|
| `baseCurrency` | Always `"USD"`. |
| `hasData` | Whether meaningful input data exists. |
| `totalNetWorth` | Total net worth in USD. |
| `missingInputs` | String messages for components that could not be fully valued. |
| `componentValues` | Array of `{ key, name, value, valueUsd, found }` rollup lines. |

---

### `GET /api/v1/me/cash`

Cash accounts with balances and USD valuation using live FX (same USD pivot as the app).

**Response (JSON):**

| Field | Description |
|-------|-------------|
| `baseCurrency` | `"USD"`. |
| `accounts` | Array of `{ id, name, currency, balance, fxRateToUsd, valueUsd, fxComplete }`. |
| `totalUsd` | Sum of `valueUsd` where numeric (approximate total cash in USD). |

---

### `GET /api/v1/me/holdings`

Portfolio holdings with live market data where available (aligned with dashboard portfolio payload).

**Response (JSON):**

| Field | Description |
|-------|-------------|
| `baseCurrency` | `"USD"`. |
| `isEmpty` | No positions. |
| `totals` | Aggregate totals object from the portfolio builder. |
| `totalPnlPct` | Overall P&L percentage field from the service. |
| `tableRows` | Position rows (symbols, weights, prices, P&amp;L, etc.) — same general shape as the in-app portfolio table. |

---

### `GET /api/v1/me/scenario-plan`

Returns a **single scenario plan** (the same data you edit under *Scenario planning* in the app): scenario name, simulated buys, simulated sells, and **expected prices** (worst price and optional exit price per symbol).

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `planName` | string | omitted | Scenario **name** (case-insensitive, trimmed). Must match a scenario you own. If **omitted**, empty, or whitespace-only, the server returns the **active** scenario plan. |

**Response `200` (JSON):**

| Field | Description |
|-------|-------------|
| `scenarioId` | UUID of the scenario. |
| `scenarioName` | Display name of the scenario. |
| `isActive` | Whether this scenario is currently the active plan. |
| `hypotheticalPurchases` | Array of simulated buy lines (`symbol`, `qty`, `buyPrice`, `currency`, `comment`, etc.) — same shape as the app’s scenario inputs. |
| `hypotheticalSales` | Array of simulated sell lines (`symbol`, `qty`, `sellPrice`, `feeFlat`, `currency`, `comment`, etc.). |
| `expectedPrices` | Array of `{ symbol, currency, worstPrice, exitPrice }`. `worstPrice` is the primary expected price; `exitPrice` is the second price when set, otherwise `null`. |

**Errors:**

| Status | When |
|--------|------|
| `404` | No **active** scenario when `planName` is omitted/empty, or no scenario matches the given **name**. |

**Example:**

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/me/scenario-plan"

curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/me/scenario-plan?planName=My%20Plan"
```

---

### `GET /api/v1/me/positions/:symbol/transactions`

Trades for a single position symbol (normalized to **uppercase** in the path).

**Query parameters:**

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `includeHistoricalSells` | `true`, `1`, `yes` (case-insensitive) | omitted / false | When enabled, includes imported **historical** sells that do **not** affect current holdings. |

**Response (JSON):**

| Field | Description |
|-------|-------------|
| `symbol` | Uppercase symbol. |
| `transactions` | Buy/sell rows that **affect holdings** (`BUY` / `SELL` with `affects_holdings = true`): ids, dates, quantities, fees, cost basis fields, etc. |
| `historicalSells` | Present only if `includeHistoricalSells` is true: past sells recorded for analytics that **do not** change the live position quantity. |

---

## Security and operations

- Use **HTTPS** in production; PATs are equivalent to passwords for your financial data.
- **Rotate** PATs if leaked; revoke the old id via `DELETE /api/user/api-tokens/:id`.
- The server stores only a **hash** of the PAT; lost tokens cannot be recovered — create a new one.
- Heavy endpoints may call market and FX providers; expect **latency** and occasional **empty or partial** valuation when upstream data is missing (`missingInputs`, `fxComplete: false`).

---

## Health check (unauthenticated)

`GET /api/health` returns `{ "ok": true }` and does not require authentication.
