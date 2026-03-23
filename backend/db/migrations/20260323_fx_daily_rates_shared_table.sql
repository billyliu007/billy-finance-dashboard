-- Shared daily FX rate sets to avoid duplicating full FX maps per user snapshot row.
CREATE TABLE IF NOT EXISTS fx_daily_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_utc DATE NOT NULL,
  provider TEXT NOT NULL,
  rates JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date_utc, provider)
);

ALTER TABLE networth_history
ADD COLUMN IF NOT EXISTS fx_rate_set_id UUID REFERENCES fx_daily_rates (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fx_daily_rates_date_provider
ON fx_daily_rates (date_utc DESC, provider);

CREATE INDEX IF NOT EXISTS idx_networth_history_fx_rate_set_id
ON networth_history (fx_rate_set_id);
