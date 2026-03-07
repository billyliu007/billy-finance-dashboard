# Migration: Off Google Sheets

Goal: store personal data in a DB, get forex and asset prices from 3rd‑party APIs, and keep daily net worth snapshots for the trend chart.

---

## 1. Store personal data in a DB

**Scope:** Replace sheet-backed “Net Worth” and “Portfolio” data with database tables.

**Suggested stack:** **PostgreSQL** (Render has a free Postgres add-on; fits production). For local dev, same DB or SQLite.

**Proposed schema (minimal):**

| Table | Purpose |
|-------|--------|
| `cash_positions` | DBS, Moomoo cash, Binance USDT, CNY debt, etc. (name, currency, amount, type=asset/liability, category) |
| `portfolio_holdings` | BTC, ETH, QQQ, etc. (symbol, name, category, quantity, purchase_price_optional, currency) |
| `net_worth_snapshots` | One row per day: `date`, `total_net_worth_cny`, optional JSON breakdown for chart |

- No auth in this outline (single user). Auth can be added later.
- Backend reads/writes these tables; frontend keeps calling the same dashboard APIs; responses are built from DB + prices instead of Sheets.

---

## 2. Forex and asset prices from 3rd‑party APIs (free)

**Forex (free):**

- **Frankfurter** – `https://api.frankfurter.app` – free, no API key, good for SGD/USD/CNY.
- Alternatives: ExchangeRate-API, Fixer.io (free tiers with key).

**Stocks (free, with pre/post/24h where possible):**

- **Finnhub** – free tier, real-time and 24h; candles for US equities; can support pre/post via candle intervals.
- **Alpha Vantage** – free tier; “GLOBAL_QUOTE” and “TIME_SERIES_INTRADAY” for US; extended hours in some endpoints.
- **Yahoo Finance (unofficial)** – e.g. `yfinance` (Node: `yahoo-finance2` or similar) – often includes pre/post and 24h; no official API, so use with fallback.

**Crypto (free):**

- **CoinGecko** – free, no key for basic price; 24h data.
- **Binance public API** – 24h ticker.

**Recommendation:**

- **Forex:** Frankfurter (no key) or ExchangeRate-API (free key).
- **Stocks:** Finnhub or Alpha Vantage for “official” API; optionally Yahoo-based library for pre/post/24h as enhancement.
- **Crypto:** CoinGecko (or Binance for symbols you care about).

**Pre/post / 24h:**

- US equities: Finnhub/Alpha Vantage “last” or “close” often reflect regular session; for explicit pre/post/24h we’d use intraday or extended-hours endpoints (both have limits on free tier).
- Crypto: 24h price is standard (CoinGecko, Binance).
- We can expose in the UI: “Last price (regular)” vs “Pre/Post” or “24h” when the chosen API provides it.

---

## 3. Net worth trend = daily snapshots (no Sheets)

**Current:** A Google-side job (e.g. Apps Script) writes a daily row into a sheet; the app reads that sheet for the trend.

**Target:** Same idea, but:

- **Compute:** Backend computes “today’s” net worth from:  
  - DB (cash positions + portfolio holdings)  
  - Latest forex rates and asset prices from the APIs above  
- **Store:** Insert one row per day into `net_worth_snapshots` (e.g. `date`, `total_net_worth_cny`, optional breakdown).
- **Run daily:** A **scheduled job** runs once per day and:
  1. Fetches latest forex + prices,
  2. Computes net worth,
  3. Upserts today’s row into `net_worth_snapshots`.

**Where to run the job:**

- **Render:** Cron job service (scheduled to run once per day and call your backend or a dedicated script).
- **Alternative:** External cron (e.g. cron-job.org) hitting a protected endpoint on your backend that performs the same steps.

No more Google backend; the “daily updater” is this cron + your backend + DB.

---

## 4. High-level flow after migration

1. **Config / data entry:** You (or a simple admin UI) manage cash positions and portfolio holdings in the DB (no Sheets).
2. **Forex + prices:** Backend fetches forex (Frankfurter or other) and stock/crypto prices (Finnhub/Alpha Vantage + CoinGecko) on demand for the dashboard and for the daily job.
3. **Dashboard:** Existing “Net Worth” and “Portfolio” pages call the same backend; backend reads DB + price APIs and returns the same shape as today (so frontend changes are minimal).
4. **Trend chart:** Backend reads `net_worth_snapshots` (and optionally cashflow-style series) from DB instead of from a sheet.
5. **Daily snapshot:** Cron runs once per day → backend computes net worth from DB + latest APIs → writes/updates `net_worth_snapshots` for today.

---

## 5. Phased implementation (suggested)

| Phase | What | Outcome |
|-------|------|--------|
| **1** | DB + schema (Postgres), CRUD for cash positions and portfolio holdings; backend reads from DB instead of Sheets; no price APIs yet (use stored “last price” or manual). | App works off DB; Sheets unused for positions. |
| **2** | Integrate forex API + one stock/crypto price API; backend computes net worth and portfolio value using live prices; optional caching (e.g. 15 min). | Live forex + asset prices; pre/post/24h wired where API supports it. |
| **3** | `net_worth_snapshots` table + daily cron job that computes and stores today’s net worth. Trend chart reads from this table. | Daily net worth trend without Google. |

If you confirm this direction (DB for personal data, Frankfurter + Finnhub/Alpha Vantage + CoinGecko, daily snapshot in DB + cron), next step is **Phase 1**: schema, migration script, and backend switch from Sheets to DB for positions and holdings, plus a minimal way to edit data (API or simple UI).
