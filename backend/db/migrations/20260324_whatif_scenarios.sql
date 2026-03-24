CREATE TABLE IF NOT EXISTS whatif_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatif_target_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES whatif_scenarios (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  target_price NUMERIC(20, 8) NOT NULL,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scenario_id, symbol)
);

CREATE TABLE IF NOT EXISTS whatif_hypothetical_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES whatif_scenarios (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  qty NUMERIC(20, 8) NOT NULL,
  buy_price NUMERIC(20, 8) NOT NULL,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatif_scenarios_user_active
  ON whatif_scenarios (user_id)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatif_scenarios_user_name
  ON whatif_scenarios (user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_whatif_scenarios_user_id ON whatif_scenarios (user_id);
CREATE INDEX IF NOT EXISTS idx_whatif_target_prices_scenario_id ON whatif_target_prices (scenario_id);
CREATE INDEX IF NOT EXISTS idx_whatif_hypothetical_purchases_scenario_id ON whatif_hypothetical_purchases (scenario_id);
