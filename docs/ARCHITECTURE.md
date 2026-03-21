# Architecture overview

This document describes how the **My Worth Track** full-stack app is structured, how data flows, and how deployment configuration maps to runtime behavior. Use it alongside [`OPTIMIZATION_AND_REFACTOR.md`](./OPTIMIZATION_AND_REFACTOR.md) for incremental improvements.

---

## High-level diagram

```
Browser (Vite SPA)
    │  GET /api/dashboard, mutations…
    ▼
Express (`backend/src/server.js` → `app.js`)
    │  auth middleware, routes
    ▼
Services (`backend/src/services/*`)  ← business logic, aggregation, external APIs
    │
    ▼
Repositories (`backend/src/repositories/*`)  ← SQL only (parameterized queries)
    │
    ▼
PostgreSQL (local, Render Postgres, **Neon**, etc.) via `pg` `Pool`
```

---

## Backend layers

| Layer | Role | Examples |
|--------|------|----------|
| **Routes** | HTTP, validation, call services | `routes/dashboard.js`, `routes/portfolio.js` |
| **Services** | Orchestration, caching in-request, Finnhub/Coinbase/FX | `dashboardService.js`, `marketDataService.js` |
| **Repositories** | DB access; transactions via `withTransaction` / `query` | `currencyRepository.js`, `cashRepository.js`, `netWorthHistoryRepository.js`, `marketReferenceRepository.js`, `portfolioRepository.js` (barrel: `financeRepository.js`), `userRepository.js` |
| **Lib** | Pure helpers | `priceResolution.js`, `portfolioFx.js` |

**DRY / quality:** Shared price resolution and central error middleware are documented as implemented in [`OPTIMIZATION_AND_REFACTOR.md`](./OPTIMIZATION_AND_REFACTOR.md). Further splits (e.g. repository modules by domain) are optional follow-ups.

---

## Database & Neon

### Current stack

- **Driver:** [`pg`](https://node-postgres.com/) with a **singleton `Pool`** (`backend/src/db/client.js`).
- **Patterns:**
  - **`query(text, params)`** — single-statement reads/writes that do not need a transaction.
  - **`withTransaction(task)`** — `BEGIN` → `task(client)` → `COMMIT`, or `ROLLBACK` on error (use for all multi-statement atomic work).
  - **`withDbClient(task)`** — acquires a client without wrapping a transaction (e.g. read-then-insert without explicit `BEGIN`, or non-transactional sequences).

This fits **long-lived Node processes** (local `npm run dev`, **Render web service**, **Render cron**).

### When to use `@neondatabase/serverless`

Use Neon's **serverless** driver when the runtime **cannot hold a TCP connection pool**:

- Vercel Edge / Cloudflare Workers  
- AWS Lambda without RDS Proxy–style pooling  
- Very short-lived invocations

**This repo's backend is not in that category** on Render: keep **`pg` + `Pool`**. If you later add a **serverless** API route, use the serverless client **only** in that entrypoint—not mixed with the global `Pool` on the same process without care.

### Neon-specific tips

1. **Connection string:** Prefer Neon's **pooled** host (e.g. `*.pooler.neon.tech`) for app servers to avoid exhausting DB connections.
2. **Pool size:** Cap concurrent clients (see `PGPOOL_MAX` in `backend/.env.example`). Neon free/low tiers have low `max_connections`; align pool × instance count with Neon's docs.
3. **SSL:** Cloud Postgres typically needs TLS. This app sets `ssl` from `DATABASE_SSL` (see `client.js`); Neon's URLs usually include `sslmode=require`.

### Query performance

- Repositories already use **parameterized** queries (`$1`, `$2`, …).
- Indexes for hot paths (`user_id`, net worth history) are noted in [`OPTIMIZATION_AND_REFACTOR.md`](./OPTIMIZATION_AND_REFACTOR.md).
- Avoid N+1: batch lookups where loops hit the DB (Coinbase product batching is implemented there).

---

## Frontend state & API performance

### Dashboard state

- **`DashboardContext`** holds one **`GET /api/dashboard`** payload (`netWorth`, `portfolio`, `fxRates`, …).
- **Refresh:** `refresh()` bumps a nonce; effect refetches with abort + optional **silent** mode (no full-page loading flash).
- **Polling:** ~60s when the tab is **visible**; refetch on **visibility change** to reduce stale data without hammering the API.

**Possible future optimizations** (only if payloads or traffic grow):

| Idea | Trade-off |
|------|-----------|
| Optional thin slice endpoints (e.g. net worth only) | Extra surface area; the app uses one **`GET /api/dashboard`** payload (legacy `/dashboard/net-worth` and `/dashboard/portfolio` were removed) |
| **SWR / React Query** | Caching, deduplication, background revalidation; adds dependency |
| **ETag / `If-None-Match`** on dashboard | Less bandwidth when unchanged; requires backend support |

### API response time (backend)

- Dashboard already loads positions **once** and shares quotes between net worth and portfolio (see optimization doc).
- External calls (Finnhub, Coinbase, Frankfurter) dominate latency; consider **short TTL in-memory cache** per process for quotes/FX if rate limits and freshness allow.

---

## Configuration alignment

### `render.yaml`

- Declares **web** (backend), **static** (frontend), **cron** (daily snapshot).
- **`DATABASE_URL`** / **`DATABASE_SSL`** must match what `client.js` expects (TLS for hosted Postgres).
- Migrations are **manual** (documented in `render.yaml` header and `DEPLOYMENT.md`).

### `DEPLOYMENT.md` vs `render.yaml`

- Some optional env vars may be listed in `DEPLOYMENT.md` (e.g. legacy flags) that are **not** duplicated in `render.yaml`. Treat the **Render dashboard / env group** as source of truth for secrets; YAML for service shape and non-secret defaults.

### CI (`.github/workflows/ci.yml`)

- Installs root + backend + frontend and **builds the frontend**; does not run DB-backed tests unless you add a job with a service container. Align any future **backend test** job with `DATABASE_URL` or mocks.

---

## Documentation index

| Doc | Purpose |
|-----|---------|
| [`README.md`](../README.md) | Setup, run, high-level features |
| [`DEPLOYMENT.md`](../DEPLOYMENT.md) | Render blueprint, env vars |
| [`render.yaml`](../render.yaml) | Infrastructure as code for Render |
| [`OPTIMIZATION_AND_REFACTOR.md`](./OPTIMIZATION_AND_REFACTOR.md) | DRY refactors, N+1, error middleware, indexes |
| **This file** | Layering, DB/Neon, state, config consistency |

---

### Removed API aliases (intentional breaking cleanup)

- **`GET /api/dashboard/net-worth`** and **`GET /api/dashboard/portfolio`** — removed; use **`GET /api/dashboard`** and read `netWorth` / `portfolio` from the JSON body.
- **`/api/profitability`** — removed duplicate mount; use **`/api/trading-performance`** only.

---

## Changelog (architecture doc)

- **2026-03:** Initial architecture doc; DB pool env tuning documented alongside Neon guidance.
- **2026-03:** Documented `withTransaction` and CI backend tests.
- **2026-03:** Removed deprecated dashboard slice routes and duplicate profitability API path.
- **2026-03:** Split finance repositories into domain files; routes use `asyncHandler`; frontend uses toast context for delete errors.
