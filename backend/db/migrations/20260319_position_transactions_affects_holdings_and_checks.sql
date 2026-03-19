-- Position transactions: ensure table exists and add affects_holdings + constraints/indexes.

CREATE TABLE IF NOT EXISTS portfolio_position_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'BUY' CHECK (type IN ('BUY', 'SELL')),
  affects_holdings BOOLEAN NOT NULL DEFAULT TRUE,
  tx_date DATE NOT NULL,
  qty NUMERIC(20, 8) NOT NULL,
  avg_cost_per_unit NUMERIC(20, 8) NOT NULL,
  cost_basis_per_unit NUMERIC(20, 8),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS type TEXT;

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS cost_basis_per_unit NUMERIC(20, 8);

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS affects_holdings BOOLEAN;

UPDATE portfolio_position_transactions
SET affects_holdings = TRUE
WHERE affects_holdings IS NULL;

ALTER TABLE portfolio_position_transactions
ALTER COLUMN affects_holdings SET NOT NULL;

ALTER TABLE portfolio_position_transactions
ALTER COLUMN affects_holdings SET DEFAULT TRUE;

UPDATE portfolio_position_transactions
SET type = 'BUY'
WHERE type IS NULL OR trim(type) = '';

ALTER TABLE portfolio_position_transactions
ALTER COLUMN type SET NOT NULL;

ALTER TABLE portfolio_position_transactions
ALTER COLUMN type SET DEFAULT 'BUY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_position_transactions_type_check'
  ) THEN
    ALTER TABLE portfolio_position_transactions
    ADD CONSTRAINT portfolio_position_transactions_type_check CHECK (type IN ('BUY','SELL'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_position_transactions_sell_basis_check'
  ) THEN
    ALTER TABLE portfolio_position_transactions
    ADD CONSTRAINT portfolio_position_transactions_sell_basis_check
    CHECK (
      (type = 'BUY' AND cost_basis_per_unit IS NULL)
      OR (type = 'SELL' AND cost_basis_per_unit IS NOT NULL)
    );
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_user_symbol
ON portfolio_position_transactions (user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_user_symbol_date
ON portfolio_position_transactions (user_id, symbol, tx_date DESC);

