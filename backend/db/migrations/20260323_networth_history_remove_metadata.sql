-- Remove legacy networth_history metadata now that shared FX sets are stored in fx_daily_rates.
ALTER TABLE networth_history
DROP COLUMN IF EXISTS metadata;
