CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  public_id TEXT UNIQUE NOT NULL,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS cash_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  component_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  component_type TEXT NOT NULL CHECK (component_type IN ('asset', 'liability')),
  category TEXT NOT NULL DEFAULT 'Cash',
  currency TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, component_key)
);

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  qty NUMERIC(20, 8) NOT NULL,
  purchase_price NUMERIC(20, 8) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS networth_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date_utc DATE NOT NULL,
  recorded_at_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'imported', 'daily')),
  total_cny NUMERIC(20, 6) NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'full' CHECK (quality_status IN ('full', 'partial', 'failed')),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_cash_components_user_id ON cash_components (user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_positions_user_id ON portfolio_positions (user_id);
CREATE INDEX IF NOT EXISTS idx_networth_history_user_id_date ON networth_history (user_id, date_utc DESC);
