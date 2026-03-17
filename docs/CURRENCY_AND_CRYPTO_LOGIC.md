# Currency and crypto (USDT/USDC) – current logic summary

Summary of how **cash**, **currencies**, and **crypto assets** (including USDT/USDC) are managed, for refactoring.

---

## 1. Cash (Net Worth)

### Storage

- **Table:** `cash`
- **Columns:** `id`, `user_id`, `currency`, `name`, `balance`, `updated_at`
- **Currency:** Stored as **uppercase** (e.g. `USD`, `CNY`). No separate “quote” or “stablecoin” flag.
- **Source:** `backend/src/repositories/financeRepository.js` – `listCashComponents`, `replaceCashComponents`

### Currencies available for cash

- **List:** `GET /api/currencies` → `listCurrencies()` → table `currencies` (active codes only).
- **Seeded in migrate:** AUD, BRL, CAD, CHF, **CNY**, … **USD**, **USDT** (Tether), **USDC** (USD Coin), ZAR, etc.
- **USDT / USDC:** In the `currencies` table; users **can** select them in Add/Edit Cash. For net worth and FX they are normalized to USD (see below).

### Backend normalization (cash → aggregation)

- **File:** `backend/src/lib/number.js` – `normalizeCurrencyCode(currency)`
  - **USDT and USDC → USD** for aggregation only (e.g. net worth totals, FX).
  - **RMB → CNY.**
- **Usage:** `backend/src/services/netWorthService.js` – `buildDetailRows()` uses `normalizeCurrencyCode(item.currency)`, so cash rows stored as `USDT` or `USDC` are treated as **USD** in totals and FX.

### Frontend (cash)

- **Add/Edit Cash:** `AddCashModal.jsx`, `EditCashModal.jsx` – currency comes from `GET /api/currencies`; options include USDT and USDC.
- **Display:** `CashTableCard.jsx` – shows `item.instrument` (name), `item.currency`, `item.amountLocal`; formatting uses `formatCurrencyValue(value, item.currency)`.
- **Frontend formatter:** `frontend/src/utils/formatters.js` – `normalizeCurrencyCode()` only maps **RMB → CNY** (no USDT/USDC → USD, so display shows “USDT”/“USDC”). `formatCurrencyValue()` formats USDT/USDC as e.g. `1,234.00 USDT`.

### Net worth aggregation

- **FX:** `getLiveFxRates(currenciesFromCash)` – rates are fetched for the **normalized** currency set (so if we ever had USDT/USDC cash, they’d be USD for FX).
- **Detail rows:** Each cash component becomes a row with `currency = normalizeCurrencyCode(item.currency)` (backend). Totals and “in base currency” values use these normalized currencies and FX.

---

## 2. Crypto assets (portfolio positions)

### Storage

- **Table:** `portfolio_positions`
- **Relevant columns:** `symbol`, `category`, `qty`, `purchase_price`, `market_provider`, `market_instrument_id`
- **Crypto:** `category = 'Crypto Assets'`; `market_provider = 'coinbase'`; `market_instrument_id` = Coinbase product id (e.g. `BTC-USDT`, `ETH-USDC`).

### How crypto is chosen (USDT/USDC only)

- **Add crypto:** User picks a **Coinbase product** from `GET /api/market/coinbase-products?q=...`.
- **Backend:** `listCoinbaseProducts()` in `financeRepository.js` filters:
  - `WHERE quote_currency IN ('USDC', 'USDT')`
- So **only USDC/USDT‑quoted pairs** are allowed (e.g. BTC-USDT, ETH-USDC). No “raw” BTC or USD-only product.
- **Create position:** `createCryptoPositionFromCoinbaseProduct()` – checks `product.quoteCurrency` is USDC or USDT; stores `symbol = product.baseCurrency` (e.g. `BTC`), `market_instrument_id = product.productId` (e.g. `BTC-USDT`).

### Pricing (crypto)

- **Source:** `marketDataService.js` – `getCryptoQuoteMapForPositions(positions)`.
  - Only **Coinbase** is used: builds targets from `position.symbol` + `position.marketInstrumentId`, fetches via `fetchCoinbaseProductQuotes()`.
- **Result:** Quotes are in the **quote currency of the product** (USDT or USDC), which is effectively **USD** for display and aggregation.
- **Portfolio / net worth:** Crypto positions are converted to a **USD** value (qty × price), then included in USD totals and converted to base currency (CNY/USD/etc.) via FX.

### Config / fallbacks

- **portfolioConfig.js:** Default `providerSymbols` for BTC/ETH use **USDT** (e.g. `coinbase: 'BTC-USDT'`). Used when building provider targets; actual positions use `market_instrument_id` from the DB.
- **Migration:** Old crypto positions get `market_instrument_id` set to `BTC-USDT` / `ETH-USDT` by symbol when `category` is crypto.

---

## 3. Where USDT/USDC appear

| Area | USDT/USDC handling |
|------|---------------------|
| **Cash currency dropdown** | USDT and USDC available (in `currencies` table). |
| **Cash storage** | Stored as `currency = 'USDT'` or `'USDC'`; backend treats as USD in aggregation. |
| **Backend cash aggregation** | `normalizeCurrencyCode()` maps USDT/USDC → USD. |
| **Frontend cash display** | No special case; would show “USDT”/“USDC” if we ever stored them (frontend formatter doesn’t map them). |
| **Crypto positions** | Only Coinbase products with **quote_currency IN ('USDC','USDT')**; position stores base (e.g. BTC) and product id (e.g. BTC-USDT). |
| **Crypto pricing** | Always via Coinbase product price (in USDT or USDC ≈ USD). |
| **FX rates** | Requested for normalized currencies only; USDT/USDC are not requested (they’re folded to USD). |

---

## 4. Inconsistencies / refactor hooks

1. **Backend vs frontend currency normalization**
   - Backend: USDT/USDC → USD in `number.js`.
   - Frontend: no USDT/USDC mapping in `formatters.js`; if we ever show USDT/USDC cash, display would say “USDT” and `Intl` might not have a symbol for it.

2. **Cash vs “stablecoin”**
   - Cash is “currency + name + balance”. There is no separate “this is a stablecoin” or “quote currency” concept; only the single `currency` field. So we can’t distinguish “USD in bank” vs “USDT in exchange” unless we use name or add a field.

3. **Crypto quote currency not stored**
   - We store `market_instrument_id` (e.g. `BTC-USDT`) but not a dedicated “quote currency” on the position. Quote is implied by the product (USDC or USDT). If we ever support multiple quote currencies per asset, we’d need to persist or derive it.

4. **Single list of currencies**
   - One `currencies` table for cash. No separate “stablecoins” or “crypto cash” list; adding USDT/USDC would be a product decision (show in same dropdown vs separate section).

5. **Net worth totals**
   - All non-CNY cash is converted to CNY (or base) via FX. USDT/USDC, if present, are treated as USD for that conversion. No separate “stablecoin” bucket in the overview.

---

## 5. Key files (for refactor)

| Concern | Files |
|--------|--------|
| Cash CRUD / list | `backend/src/repositories/financeRepository.js` (cash, listCashComponents, replaceCashComponents) |
| Currency list | `backend/src/repositories/financeRepository.js` (listCurrencies), `backend/src/db/migrate.js` (currency rows) |
| USDT/USDC → USD | `backend/src/lib/number.js` (normalizeCurrencyCode) |
| Net worth aggregation | `backend/src/services/netWorthService.js` (buildDetailRows, aggregateComputedTotals, mapCashDetailRowsToTableRows) |
| Crypto positions (USDC/USDT only) | `backend/src/repositories/financeRepository.js` (listCoinbaseProducts, createCryptoPositionFromCoinbaseProduct) |
| Crypto pricing | `backend/src/services/marketDataService.js` (getCryptoQuoteMapForPositions), `backend/src/lib/crypto.js` |
| Cash UI (currency dropdown) | `frontend/src/components/networth/AddCashModal.jsx`, `EditCashModal.jsx` (useApiData('/api/currencies')) |
| Currency display | `frontend/src/utils/formatters.js` (normalizeCurrencyCode, formatCurrencyValue) |
| Coinbase product sync | `backend/src/scripts/syncCoinbaseProducts.js` (filters quote_currency IN ('USDC','USDT')) |

---

This summarizes the current logic so you can refactor how crypto asset currency and cash USDT/USDC are managed in one place.
