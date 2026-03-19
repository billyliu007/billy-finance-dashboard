-- Optional flat fees (per transaction).
-- If fee_flat_total is null, older fee_per_unit data can be interpreted as per-unit
-- in JS for backward compatibility.

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS fee_flat_total NUMERIC(20, 8);

