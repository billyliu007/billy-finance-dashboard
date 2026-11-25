-- Recurring buys (e.g. Binance auto-invest): one BUY row per plan holding its running totals.
-- The plan name is kept in notes. Existing transactions are ordinary purchases.
ALTER TABLE portfolio_position_transactions
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;
