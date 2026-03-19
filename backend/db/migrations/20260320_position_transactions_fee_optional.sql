-- Optional transaction fees.
-- When present:
-- - For BUY: buys cash impact includes qty * fee_per_unit.
-- - For SELL: sells cash impact includes qty * fee_per_unit (fee reduces net proceeds).
-- If omitted, fees default to NULL and are treated as 0 in analytics.

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS fee_per_unit NUMERIC(20, 8);

