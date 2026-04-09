-- Optional second target price per symbol for what-if scenarios
ALTER TABLE whatif_target_prices
  ADD COLUMN IF NOT EXISTS target_price_2 NUMERIC(20, 8) NOT NULL DEFAULT 0;
