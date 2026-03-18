CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  public_id TEXT UNIQUE NOT NULL,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'wechat')),
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  name TEXT NOT NULL,
  balance NUMERIC(20, 6) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT,
  qty NUMERIC(20, 8) NOT NULL,
  purchase_price NUMERIC(20, 8) NOT NULL,
  market_provider TEXT,
  market_instrument_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

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

CREATE TABLE IF NOT EXISTS networth_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date_utc DATE NOT NULL,
  recorded_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'imported', 'daily')),
  total_cny NUMERIC(20, 6) NOT NULL,
  total_usd NUMERIC(20, 6),
  quality_status TEXT NOT NULL DEFAULT 'full' CHECK (quality_status IN ('full', 'partial', 'failed')),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coinbase_products (
  product_id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  status TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS us_stock_symbols (
  symbol TEXT PRIMARY KEY,
  security_name TEXT,
  exchange TEXT,
  market_category TEXT,
  etf BOOLEAN,
  test_issue BOOLEAN,
  financial_status TEXT,
  round_lot_size INTEGER,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_cash_user_id ON cash (user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_positions_user_id ON portfolio_positions (user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_user_symbol ON portfolio_position_transactions (user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_user_symbol_date ON portfolio_position_transactions (user_id, symbol, tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_networth_history_user_id_date ON networth_history (user_id, date_utc DESC);
CREATE INDEX IF NOT EXISTS idx_coinbase_products_base_quote ON coinbase_products (base_currency, quote_currency);
CREATE INDEX IF NOT EXISTS idx_us_stock_symbols_exchange ON us_stock_symbols (exchange);
