# Optimization and refactor recommendations

Based on the current logic, these are the main areas that could be improved. None are urgent; the app works. Prioritise by impact and time.

---

## Backend

### 1. **N+1 in `replacePortfolioPositions` (financeRepository.js)**

When onboarding or replacing positions, for each **crypto** position we call `findCoinbaseProduct(item.marketInstrumentId)` inside the loop. With many crypto positions this is one DB query per position.

**Suggestion:** Load all needed Coinbase products in one query before the loop, e.g.:

- Collect unique `marketInstrumentId` values from crypto items.
- `SELECT product_id, quote_currency FROM coinbase_products WHERE product_id = ANY($1)` once.
- Use a `Map(productId → quoteCurrency)` when setting `currency` in the loop.

**Impact:** Fewer DB round-trips on onboarding/bulk replace. Low effort.

---

### 2. **Duplicate “resolve position price” logic**

- **portfolioService.js:** `resolveCurrentPrice(asset, stockQuotes, cryptoQuotes)` → returns `{ currentPrice, priceSource, priceTimestamp }` or “unavailable”.
- **netWorthService.js:** `resolvePositionCurrentPrice(asset, stockQuotes, cryptoQuotes)` → returns a number or null, and net worth uses it only for totals.

Both depend on `isStockAsset` / `isCryptoAsset` and the same quote maps. Behaviour is slightly different (portfolio needs source/timestamp, net worth only needs a number).

**Suggestion:** Extract a small shared helper, e.g. in `lib/assetUtils.js` or `lib/priceResolution.js`:

- `resolvePositionPrice(asset, stockQuotes, cryptoQuotes) → { price: number | null, source?, timestamp? }`.
- Net worth uses `price`; portfolio uses the full object. Both services call this instead of duplicating the lookup and category checks.

**Impact:** Single place for price-resolution rules; easier to change (e.g. new asset type). Medium effort.

---

### 3. **Large `financeRepository.js`**

The file holds cash, portfolio, net worth history, currencies, Coinbase products, and US stock symbols. It’s a lot of concerns in one module.

**Suggestion:** Split by domain (when you touch that area):

- `cashRepository.js` – cash CRUD, list.
- `portfolioRepository.js` – positions, create/update/delete, Coinbase product lookup.
- `netWorthRepository.js` – net worth history list/replace.
- Keep shared helpers (e.g. `query`, `withDbClient`) in `db/client.js` or a thin `repositories/common.js` if needed.

**Impact:** Easier to navigate and test. No behaviour change. Medium effort.

---

### 4. **Repeated error handling in `app.js`**

Many routes do the same thing: `try { ... } catch (error) { return res.status(500).json({ message: getErrorMessage(error) }); }` (or 400/409).

**Suggestion:** Use a central error middleware and throw or pass errors from route handlers:

- Middleware that reads `err.statusCode` (or a custom property) and `getErrorMessage(err)` and sends the right JSON.
- Route handlers `throw` or `next(err)` instead of repeating `res.status(...).json(...)`.

**Impact:** Less boilerplate; consistent error responses. Low–medium effort.

---

### 5. **Dashboard payload: positions and quotes**

- `resolveDashboardPayload` loads positions once and passes them to both `buildNetWorthPayload` and `buildPortfolioPayload`.
- Stock/crypto quotes are fetched once and shared. Good.

No change needed here; structure is already efficient.

---

## Frontend

### 6. **Single dashboard load and refresh**

- One `GET /api/dashboard` loads net worth + portfolio; Net Worth and Portfolio pages use the same context. No duplicate request when switching tabs.
- After mutations (add/edit/delete cash, add/edit/delete position), pages call `refresh()` which refetches the full dashboard.

**Suggestion (optional):** If you later add more dashboard sections and the payload grows, consider:

- Splitting endpoints (e.g. net worth only, portfolio only) and having each page fetch only what it needs, or
- Keeping one endpoint but returning smaller slices (e.g. only cash for net worth) and refetching only the slice that changed after a mutation.

Not necessary at current scale.

---

### 7. **Error feedback after mutations**

Some flows use `window.alert(err?.message)` (e.g. delete cash, delete position). Works but is not ideal for accessibility or consistency.

**Suggestion:** Use a small toast or inline error state (e.g. context or a shared hook) so success/error messages are consistent and non-blocking. Low priority.

---

### 8. **Formatters (formatters.js)**

- `formatCurrencyValue` has branches for SGD, USDT/USDC, then a generic path. A bit long but clear.
- No need to refactor unless you add many more special cases; then consider a small map or strategy (e.g. by currency code).

---

## Database

### 9. **Indexes**

- **portfolio_positions:** `idx_portfolio_positions_user_id` – good for “all positions for user”.
- **networth_history:** `idx_networth_history_user_id_date`, plus unique `idx_networth_history_user_recorded_source` from migrate – good for history by user and upserts.
- **cash:** `idx_cash_user_id` – good for “all cash for user”.

No extra indexes are required for current query patterns. If you add queries that filter cash by `(user_id, currency)` or positions by `(user_id, category)`, add indexes then.

---

### 10. **Migrations**

- `migrate.js` is a single long script: schema changes, backfills, and data fixes. It’s idempotent (IF NOT EXISTS, etc.), which is good.

**Suggestion (later):** If you introduce more migrations over time, consider versioned migration files (e.g. `001_initial.sql`, `002_add_currency.sql`) and a small runner that applies only new ones. Not urgent.

---

## Summary

| Area        | Change                                      | Impact              | Effort   |
|------------|---------------------------------------------|---------------------|----------|
| Backend    | Batch Coinbase product lookup in replace    | Fewer DB round-trips| Low      |
| Backend    | Shared position price-resolution helper      | Less duplication    | Medium   |
| Backend    | Split financeRepository by domain            | Clarity, testability| Medium   |
| Backend    | Central error middleware in app.js           | Less boilerplate    | Low–Med  |
| Frontend   | Toast / shared error state for mutations    | Better UX           | Low      |
| DB         | No change needed for current usage          | –                   | –        |

Recommended order if you do them: (1) N+1 fix, (4) error middleware, (2) shared price resolution, then (3) repository split when you next work in that code.

---

## Implemented (post-tag `pre-refactor-optimization`)

- **N+1 fix:** `findCoinbaseQuoteCurrenciesByIds` added; `replacePortfolioPositions` batches Coinbase product lookup.
- **Error middleware:** Central `app.use((err, _req, res, _next) => ...)`; routes use `next(error)` and `error.statusCode` (400/404/409/500).
- **Shared price resolution:** `lib/priceResolution.js` exports `resolvePositionPrice(asset, stockQuotes, cryptoQuotes)`; `portfolioService` and `netWorthService` use it.

**Revert if needed:** `git reset --hard pre-refactor-optimization` (discards refactor commit(s)) or `git revert <commit>` to undo the refactor while keeping history.
