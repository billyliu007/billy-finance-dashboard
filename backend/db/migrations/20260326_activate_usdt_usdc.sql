-- Activate stablecoins as supported currencies and widen constraints accordingly.
-- Policy: supported currency codes are USD, USDT, USDC, CNY, SGD, EUR, GBP, JPY, HKD.

-- 1) Ensure USDT/USDC exist and are active for dropdowns.
INSERT INTO currencies (code, name, active, updated_at)
VALUES
  ('USDT', 'Tether', true, NOW()),
  ('USDC', 'USD Coin', true, NOW())
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      active = true,
      updated_at = NOW();

-- 2) Replace the previous supported-currency constraints with expanded ones.
-- (We must DROP + ADD because multiple CHECK constraints would be AND-ed.)

DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT users_base_currency_supported;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_base_currency_supported
    CHECK (UPPER(TRIM(base_currency)) IN ('USD','USDT','USDC','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE cash DROP CONSTRAINT cash_currency_supported;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE cash
    ADD CONSTRAINT cash_currency_supported
    CHECK (UPPER(TRIM(currency)) IN ('USD','USDT','USDC','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE portfolio_positions DROP CONSTRAINT portfolio_positions_currency_supported;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE portfolio_positions
    ADD CONSTRAINT portfolio_positions_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','USDT','USDC','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE whatif_target_prices DROP CONSTRAINT whatif_target_prices_currency_supported;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE whatif_target_prices
    ADD CONSTRAINT whatif_target_prices_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','USDT','USDC','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE whatif_hypothetical_purchases DROP CONSTRAINT whatif_hypothetical_purchases_currency_supported;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE whatif_hypothetical_purchases
    ADD CONSTRAINT whatif_hypothetical_purchases_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','USDT','USDC','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

