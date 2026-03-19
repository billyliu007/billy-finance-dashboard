-- Net worth history: add recorded_at_utc + source, backfill, and update indexes.

ALTER TABLE networth_history
ADD COLUMN IF NOT EXISTS recorded_at_utc TIMESTAMPTZ;

ALTER TABLE networth_history
ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE networth_history
SET recorded_at_utc = COALESCE(recorded_at_utc, (date_utc::text || 'T00:00:00Z')::timestamptz)
WHERE recorded_at_utc IS NULL;

UPDATE networth_history
SET source = 'manual'
WHERE source IS NULL OR trim(source) = '';

ALTER TABLE networth_history
ALTER COLUMN recorded_at_utc SET NOT NULL;

ALTER TABLE networth_history
ALTER COLUMN recorded_at_utc SET DEFAULT NOW();

ALTER TABLE networth_history
ALTER COLUMN source SET NOT NULL;

ALTER TABLE networth_history
ALTER COLUMN source SET DEFAULT 'manual';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'networth_history_user_id_date_utc_key'
  ) THEN
    ALTER TABLE networth_history
    DROP CONSTRAINT networth_history_user_id_date_utc_key;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_networth_history_user_recorded_source
ON networth_history (user_id, recorded_at_utc, source);

CREATE INDEX IF NOT EXISTS idx_networth_history_user_id_date
ON networth_history (user_id, date_utc DESC);

