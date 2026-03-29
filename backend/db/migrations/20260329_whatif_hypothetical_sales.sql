-- Hypothetical sales for what-if scenarios (mirrors purchases shape + optional fee).

CREATE TABLE IF NOT EXISTS whatif_hypothetical_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES whatif_scenarios (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  qty NUMERIC(20, 8) NOT NULL,
  sell_price NUMERIC(20, 8) NOT NULL,
  fee_flat NUMERIC(20, 8),
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatif_hypothetical_sales_scenario_id ON whatif_hypothetical_sales (scenario_id);

DO $$
BEGIN
  ALTER TABLE whatif_hypothetical_sales
    ADD CONSTRAINT whatif_hypothetical_sales_currency_supported
    CHECK (currency IS NULL OR UPPER(TRIM(currency)) IN ('USD','USDT','USDC','CNY','SGD','EUR','GBP','JPY','HKD')) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
