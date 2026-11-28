-- Archived rounds: when an asset worth < $5 is archived, its purchases and sales (and its initial
-- holding) are sealed into a round. Archived rows still count in realized P/L but never in the
-- current holding. The asset row stays (hidden, archived_at set) so realized totals keep it.
CREATE TABLE IF NOT EXISTS position_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  category TEXT NOT NULL,
  currency TEXT,
  base_qty NUMERIC(20, 8) NOT NULL DEFAULT 0,
  base_avg_cost NUMERIC(20, 8) NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_position_archives_user_symbol ON position_archives (user_id, symbol);

ALTER TABLE portfolio_position_transactions
  ADD COLUMN IF NOT EXISTS archive_id UUID REFERENCES position_archives (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_archive ON portfolio_position_transactions (archive_id);

ALTER TABLE portfolio_positions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Any new (non-archived) purchase or sale brings an archived asset back as a fresh holding,
-- whichever path wrote it (app, external API, exchange sync, recurring buys).
CREATE OR REPLACE FUNCTION reactivate_archived_position() RETURNS trigger AS $$
BEGIN
  IF NEW.archive_id IS NULL THEN
    UPDATE portfolio_positions
    SET archived_at = NULL, updated_at = NOW()
    WHERE user_id = NEW.user_id AND upper(symbol) = upper(NEW.symbol) AND archived_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reactivate_archived_position ON portfolio_position_transactions;
CREATE TRIGGER trg_reactivate_archived_position
  AFTER INSERT ON portfolio_position_transactions
  FOR EACH ROW EXECUTE FUNCTION reactivate_archived_position();
