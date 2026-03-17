# How totals and net worth are calculated

## Portfolio: Total Unrealized P/L, Market Value, Cost Basis

**Where:** `backend/src/services/portfolioService.js` — `buildPortfolioPayload()`

### Per-position (stocks and crypto)

For each position we have:

- **Quantity** `qty` and **purchase price** `purchasePrice` (stored in DB).
- **Current price** `currentPrice` from live quotes (see “Currency handling” below).

Formulas:

| Metric | Formula |
|--------|--------|
| **Cost basis** | `totalPurchaseCost = qty × purchasePrice` |
| **Market value** | `currentValue = qty × currentPrice` |
| **Unrealized P/L** | `pnl = currentValue - totalPurchaseCost` |
| **Unrealized return %** | `pnlPct = (pnl / totalPurchaseCost) × 100` (0 if cost basis is 0) |

Positions with invalid or zero quantity are excluded from totals (`position.found`).

### Portfolio totals

Totals are simple sums over **all visible positions** (no per-currency breakdown in the portfolio view):

| Total | Calculation |
|-------|-------------|
| **Total cost basis** | Sum of each position’s `totalPurchaseCost` |
| **Total market value** | Sum of each position’s `currentValue` |
| **Total unrealized P/L** | Sum of each position’s `pnl` |
| **Total unrealized return %** | `(totalPnl / totalCost) × 100` (0 if total cost is 0) |

So: **total unrealized P/L** = **total market value** − **total cost basis**, and all three are in a single “bucket” (see currency handling below).

---

## Currency handling: stocks vs crypto

### Stocks (US)

- **Currency:** Always **USD** (stored as `currency = 'USD'`).
- **Quotes:** From Finnhub; price is in **USD**.
- **Cost basis and market value** are therefore in **USD**.
- No FX conversion in the portfolio screen; totals are “in USD”.

### Crypto

- **Currency:** Stored per position from the Coinbase product, e.g. **USDT** or **USDC** (e.g. BTC-USDT → USDT, ADA-USDC → USDC).
- **Quotes:** From Coinbase product ticker; **price is in the quote currency** (USDT or USDC). That price is treated as **USD-equivalent** (USDT/USDC ≈ 1 USD).
- **Cost basis and market value** for that position are in that quote currency, but for **aggregation we treat them as USD**:
  - We do **not** fetch a separate USDT/CNY or USDC/CNY rate for positions.
  - We use the ticker price as “price in USD” and sum with other positions and with stock (USD) positions.

So in practice:

- **Stocks:** everything in USD.
- **Crypto:** display currency can be USDT/USDC, but for **portfolio totals** and **net worth**, crypto is valued in **USD** using the same price (no extra FX for USDT/USDC).  
  Cash in USDT/USDC is normalized to USD for FX (see below).

---

## Net worth: how the total is calculated

**Where:** `backend/src/services/netWorthService.js` — `buildNetWorthPayload()`

Net worth = **cash (in all currencies)** + **positions (stocks + crypto)**.  
Everything is converted into a **base currency** (e.g. USD or CNY) using FX rates.

### 1. Cash

- Each cash row has a **currency** (CNY, USD, SGD, USDT, USDC, etc.) and a **balance** (in that currency).
- **Currency normalization** (`normalizeCurrencyCode` in `lib/number.js`):
  - **RMB** → **CNY**
  - **USDT** and **USDC** → **USD** (for FX and aggregation only).
- We need an **FX rate** from each currency to **CNY** (e.g. `fxRates.USD`, `fxRates.SGD`).  
  So for cash we look up `fxRates[normalizeCurrencyCode(currency)]` (e.g. USDT cash uses the USD rate).
- **Value in CNY** for a row: `balance × fxRates[currency]` (when the rate exists).
- Cash is then grouped by (normalized) currency and summed per currency (e.g. “USD assets in CNY”, “CNY assets total”).

### 2. Positions (stocks + crypto)

- **All positions are valued in USD** for net worth:
  - Stocks: price is already in USD.
  - Crypto: price from the API is in USDT or USDC; we use it as **USD** (no separate USDT/USDC FX for positions).
- **USD positions total:**  
  `usdPositionsTotal = Σ (qty × currentPrice)` over all positions with a valid current price (same logic as portfolio market value, in USD).
- This **USD** total is converted to CNY using **one** rate: `fxRates.USD`.  
  So: **positions in CNY** = `usdPositionsTotal × fxRates.USD`.

### 3. Aggregation and base currency

- We have components like:
  - **CNY assets total** = sum of CNY cash (already in CNY).
  - **USD assets in CNY** = USD cash (converted to CNY) + **positions in CNY** (from `usdPositionsTotal × fxRates.USD`).
  - Same idea for other currencies (e.g. SGD assets in CNY) using their FX rate; only **USD** includes the positions total.
- All these component values are in **CNY** at this stage.
- **Total net worth in base currency:**  
  If base is **CNY**, total = sum of those component values (already in CNY).  
  If base is **USD** (or another base), we convert: each component value in CNY is divided by `rateToBase` (the FX rate from CNY to base), then we sum. So **total net worth** = sum of (component value in CNY / rateToBase).

Formula in code:

- `totalNetWorth = Σ (componentValueInBase)`  
  where each component’s value was converted to base using the same FX framework (CNY as pivot, then divide by base rate if base ≠ CNY).

---

## Summary table

| Concept | Stocks | Crypto | Notes |
|--------|--------|--------|--------|
| **Position currency** | USD | USDT or USDC (from product) | Display only for crypto. |
| **Quote / price** | USD (Finnhub) | USDT or USDC (Coinbase) | Treated as USD for totals. |
| **Cost basis / market value** | In USD | In quote currency, aggregated as USD | No FX for positions. |
| **Portfolio totals** | Sum of all positions in “USD” | Same sum | Single total cost, value, P/L. |
| **Net worth – cash** | Uses `fxRates.USD` (or normalized) | USDT/USDC → USD, then `fxRates.USD` | `normalizeCurrencyCode`. |
| **Net worth – positions** | `usdPositionsTotal` × `fxRates.USD` | Same (price as USD) | One USD total, one rate to CNY. |
| **Total net worth** | Sum of all components in base currency | Same | Base = USD or CNY (or other) via FX. |

So: **portfolio** totals are “all in USD” (crypto quote currency treated as USD). **Net worth** is cash (per-currency, normalized so USDT/USDC use USD rate) + one USD positions total converted to CNY, then everything expressed in the chosen base currency.
