-- Diagnostics from the last exchange check: warnings and the raw Auto-Invest plan data
-- (used to verify Binance's response shape; no secrets are stored here).
ALTER TABLE exchange_connections ADD COLUMN IF NOT EXISTS last_sync_details JSONB;
