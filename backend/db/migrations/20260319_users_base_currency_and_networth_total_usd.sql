-- Users base currency and net worth USD column.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS base_currency TEXT;

UPDATE users
SET base_currency = 'USD'
WHERE base_currency IS NULL OR trim(base_currency) = '';

ALTER TABLE users
ALTER COLUMN base_currency SET NOT NULL;

ALTER TABLE users
ALTER COLUMN base_currency SET DEFAULT 'USD';

ALTER TABLE networth_history
ADD COLUMN IF NOT EXISTS total_usd NUMERIC(20, 6);

