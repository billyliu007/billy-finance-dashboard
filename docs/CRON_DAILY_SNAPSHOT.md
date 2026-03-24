# Daily net worth snapshot cron

This document describes how the **daily snapshot** job works: what it computes, what it writes to Postgres, and how that differs from older implementations. Operational notes for Render are in [`DEPLOYMENT.md`](../DEPLOYMENT.md) §6.

---

## Where it runs

| Environment | Entry |
|-------------|--------|
| **Render** | Cron service `netpulse-daily-snapshot` — `npm run cron:daily-snapshot --prefix backend` ([`render.yaml`](../render.yaml)) |
| **Schedule** | `0 0 * * *` — **00:00 UTC** daily (not local midnight). |
| **Local / manual** | `npm run cron:daily-snapshot --prefix backend` — optional `SNAPSHOT_DATE_UTC=YYYY-MM-DD` for a specific calendar date. |
| **HTTP (optional)** | `POST /api/internal/snapshot/daily` with header `x-cron-token: <SNAPSHOT_CRON_TOKEN>` on the **web** backend. |

Code: `backend/src/scripts/runDailySnapshot.js` → `backend/src/services/snapshotService.js` (`runDailySnapshots`).

---

## Design goals (current behavior)

1. **Same holdings math as the dashboard** — positions are merged with **position transaction aggregates** (`applyTransactionAggregatesToPositions` from `dashboardService.js`) before quotes and net worth, so cron totals align with live `GET /api/dashboard` (USD-based aggregation).
2. **Canonical snapshot currency is USD** — `buildNetWorthPayload` is called with **`baseCurrency: 'USD'`** for every user. **User display base currency (`users.base_currency`) is not used** for the snapshot total.
3. **Persist both USD and CNY columns** — `networth_history.total_usd` is the USD net worth; `total_cny` is derived as `total_usd / (USD per 1 CNY)` using the same FX map as valuation, when that rate exists.
4. **No fabricated CNY fallback** — if the CNY/USD pivot is unavailable, **`total_cny` is stored as `NULL`** (column is nullable; see migrations). `quality_status` is **`partial`** when CNY cannot be derived or when net-worth inputs are incomplete.
5. **Shared FX for the run** — one Frankfurter-based map per UTC date is upserted into **`fx_daily_rates`**; each daily row stores **`fx_rate_set_id`** pointing at it. If the batch map is missing **`CNY`**, the job merges an extra **`fetchFrankfurterFxRates(['CNY'])`** before writing `fx_daily_rates`, so the pivot is stored when the provider returns it.

---

## Execution flow (high level)

1. **Load users** — `listUsersForSnapshots()` (onboarding completed).
2. **Per user (parallel)** — cash, raw positions, history, transaction aggregates → **effective positions**.
3. **Batch once** — stock quotes, crypto quotes, and FX for the union of cash currencies across all users.
4. **Abort if unusable FX** — if the USD anchor in the FX map is not usable after retry, return a single error result (no per-user writes).
5. **Merge CNY into FX map** if missing, then **`upsertDailyFxRateSet`** → `fx_rate_set_id`.
6. **Per user** — `buildNetWorthPayload(..., baseCurrency: 'USD')` → `total_usd`; derive `total_cny`; apply skip rule; **`upsertNetWorthSnapshot`** (`source = 'daily'`, replaces same user + `date_utc` + `daily`).

---

## Skip rule

If the user has **meaningful holdings** (non-zero cash or position qty &gt; 0) but **USD net worth** is missing or effectively zero, the row is **not** written:

- `status: 'skipped'`
- `message: 'Net worth computed as zero while holdings exist. Snapshot not written.'`

That usually indicates missing stock/crypto quotes or FX for cash, not a currency-label bug.

---

## Database shape (relevant columns)

| Table | Role |
|-------|------|
| `networth_history` | `date_utc`, `source` (`daily`), `total_cny`, `total_usd`, `fx_rate_set_id`, `quality_status`. |
| `fx_daily_rates` | `date_utc`, `provider`, `rates` (JSONB: **USD per 1 unit** of each currency, with `USD: 1`). |

After schema changes, run **`npm run db:migrate`** (shared DB for Render + local). Cron needs the same migrations as the app (e.g. `fx_daily_rates`, nullable `total_cny`).

---

## How the UI uses history

Dashboard net worth **charts** read history via `listNetWorthHistory` (joined to `fx_daily_rates` for `sharedFxRates`). `buildNetWorthPayload` / `parseCashflowRows` convert points to the **user’s display base currency** using stored CNY/USD and historical FX when needed. A row with **`total_cny` null** but **`total_usd` set** can still display for CNY-base users via USD + FX conversion.

---

## Historical note (pre–2026 refactor)

Older snapshots (e.g. around commit `b149d00`) used a **CNY-first** `buildNetWorthPayload`, **per-user** quote/FX fetches, **raw** positions (no transaction aggregates), **no** `fx_daily_rates`, and derived **`total_usd` using `fxRates.USD`** (which is **`1`** in the Frankfurter map), so the **`total_usd` column did not represent true USD** even when runs appeared “stable.” The current design fixes semantics and aligns cron with the dashboard; see git history on `backend/src/services/snapshotService.js` for the full evolution.

---

## Troubleshooting (quick)

| Symptom | Things to check |
|---------|------------------|
| No new `daily` rows | Render cron **suspended**, wrong **UTC** expectation, or job **failed** (build/runtime). Check cron **logs**. |
| All users `skipped` | **USD** net worth ~0 with holdings — **Finnhub** / **Coinbase** / **FX** on the cron service (`FINNHUB_API_KEY`, `DATABASE_URL`, outbound network). |
| Cron errors on SQL | **Migrations** not applied on production DB (`npm run db:migrate`). |
| `partial` quality | Missing net-worth inputs (`missingInputs`) or **CNY** could not be derived (`total_cny` null). |

---

## Related files

| File | Purpose |
|------|---------|
| `backend/src/services/snapshotService.js` | Orchestration |
| `backend/src/services/netWorthService.js` | `buildNetWorthPayload`, history series parsing |
| `backend/src/services/dashboardService.js` | `applyTransactionAggregatesToPositions` |
| `backend/src/repositories/netWorthHistoryRepository.js` | Read/write `networth_history` |
| `backend/src/repositories/fxRatesRepository.js` | `upsertDailyFxRateSet` |
| `backend/src/lib/fx.js` | Frankfurter fetch (USD-per-unit rates) |
| `backend/tests/snapshotBaseCurrencyContract.test.js` | Regression: cron does not branch on user base currency |
