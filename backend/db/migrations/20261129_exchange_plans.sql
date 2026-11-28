-- Exchange recurring plans (Binance Auto-Invest): latest totals per plan and coin, and which
-- WorthTrack recurring buy they keep up to date. One row per (plan, coin): a portfolio plan
-- buying BTC and ETH has two rows.
CREATE TABLE IF NOT EXISTS exchange_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exchange TEXT NOT NULL,
  external_plan_id TEXT NOT NULL,
  target_asset TEXT NOT NULL,
  source_asset TEXT NOT NULL,
  name TEXT NOT NULL,
  plan_status TEXT,                           -- exchange's status, e.g. ONGOING / PAUSED
  total_qty NUMERIC(30, 12) NOT NULL,         -- coins bought by the plan so far
  total_invested NUMERIC(30, 12) NOT NULL,    -- amount invested so far (USD / stablecoin)
  first_execution_at TIMESTAMPTZ,
  linked_transaction_id UUID,                 -- WorthTrack recurring-buy row kept up to date
  ignored BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, exchange, external_plan_id, target_asset)
);
