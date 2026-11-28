-- Exchange sync: read-only exchange API keys and the trades fetched with them.
-- Secrets are AES-256-GCM encrypted by the app (EXCHANGE_KEY_ENCRYPTION_KEY); never stored in plain text.
CREATE TABLE IF NOT EXISTS exchange_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'coinbase')),
  api_key_enc TEXT NOT NULL,
  api_secret_enc TEXT NOT NULL,
  key_last4 TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (user_id, exchange)
);

-- One row per exchange order / convert / auto-invest execution (fills already grouped).
-- status: new (needs a decision), added (recorded via exchange sync), ignored (user dismissed),
-- matched (already recorded in WorthTrack before; found by order number or similarity).
CREATE TABLE IF NOT EXISTS exchange_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exchange TEXT NOT NULL,
  external_id TEXT NOT NULL,                 -- e.g. "spot:BTCUSDC:11680692515", "convert:123"
  source TEXT NOT NULL CHECK (source IN ('spot', 'convert', 'auto_invest')),
  order_ref TEXT NOT NULL,                   -- the exchange's order / transaction number
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  qty NUMERIC(30, 12) NOT NULL,              -- gross base quantity
  quote_qty NUMERIC(30, 12) NOT NULL,        -- quote amount (excl. fees charged separately)
  fee NUMERIC(30, 12) NOT NULL DEFAULT 0,
  fee_asset TEXT,
  executed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'added', 'ignored', 'matched')),
  matched_transaction_id UUID,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, exchange, external_id)
);

CREATE INDEX IF NOT EXISTS idx_exchange_trades_user_status ON exchange_trades (user_id, status, executed_at DESC);
