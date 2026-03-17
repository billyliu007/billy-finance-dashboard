# Portfolio market price: why it can show $0 or —

Market Price (and Market Value) in the Portfolio positions table come from **live quotes**. When no quote is available, the UI shows **—** (or previously $0.00) so it’s clear the value is missing, not that the asset is worth zero.

## When market price is missing

### US stocks

- **`FINNHUB_API_KEY` not set**  
  In `backend/.env`, set `FINNHUB_API_KEY` to a valid [Finnhub](https://finnhub.io/) API key. Without it, no stock quotes are fetched and all stock positions show no price.
- **Symbol not supported**  
  Finnhub covers US-listed symbols. If the symbol isn’t found or the API returns no quote, price will be missing.
- **Rate limits / API errors**  
  Failed or empty responses result in no price for that symbol.

### Crypto

- **Missing `market_instrument_id`**  
  Crypto positions need a Coinbase product id (e.g. `BTC-USDT`, `ETH-USDC`) so we can fetch the ticker. It’s stored when you add a position via “Add crypto” and pick a product. Old or imported positions without this field are skipped and get no quote.
- **Coinbase API failure**  
  Network error or non‑OK response for that product leads to no price.
- **Wrong or unsupported product**  
  Only products with quote currency USDT or USDC are used; others won’t get a quote.

### Other

- **Category not “US Stock Assets” or “Crypto Assets”**  
  Only those categories are matched to stock/crypto quote providers. Other categories never get live price.

## UI behavior

- When a quote is **unavailable**, the table shows **—** for Market Price (and Market Value when it would be zero) so it’s clear the value is missing.
- Totals and P/L only include positions that have a valid current price; positions with no quote don’t add to “Total Market Value” and don’t affect P/L.

## Fixing missing prices

1. **Stocks**: Add `FINNHUB_API_KEY` to `backend/.env` and restart the backend.
2. **Crypto**: Ensure each crypto position was added via the app’s “Add crypto” flow so it has a Coinbase product id. Re-add the position if it was created without one (e.g. onboarding/import).
