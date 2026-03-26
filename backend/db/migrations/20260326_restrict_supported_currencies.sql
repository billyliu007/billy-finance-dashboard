-- Restrict supported currencies from 2026-03-26 onward.
-- Policy: application supports only USD, CNY, SGD, EUR, GBP, JPY, HKD.
-- Existing rows may contain legacy/unsupported codes; constraints are added NOT VALID so they block new writes
-- without failing the migration on historical data.

-- 1) Ensure supported currencies exist and are active.
INSERT INTO currencies (code, name, active, updated_at)
VALUES
  ('USD', 'United States Dollar', true, NOW()),
  ('CNY', 'Chinese Renminbi Yuan', true, NOW()),
  ('SGD', 'Singapore Dollar', true, NOW()),
  ('EUR', 'Euro', true, NOW()),
  ('GBP', 'British Pound', true, NOW()),
  ('JPY', 'Japanese Yen', true, NOW()),
  ('HKD', 'Hong Kong Dollar', true, NOW())
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      active = true,
      updated_at = NOW();

-- 2) Deactivate all other currencies for dropdowns/validation.
UPDATE currencies
SET active = false,
    updated_at = NOW()
WHERE code NOT IN ('USD','CNY','SGD','EUR','GBP','JPY','HKD')
  AND active = true;

-- 3) DB-level enforcement for new writes (NOT VALID = doesn't reject legacy rows).
DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_base_currency_supported
    CHECK (UPPER(TRIM(base_currency)) IN ('USD','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE cash
    ADD CONSTRAINT cash_currency_supported
    CHECK (UPPER(TRIM(currency)) IN ('USD','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE portfolio_positions
    ADD CONSTRAINT portfolio_positions_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE whatif_target_prices
    ADD CONSTRAINT whatif_target_prices_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE whatif_hypothetical_purchases
    ADD CONSTRAINT whatif_hypothetical_purchases_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

