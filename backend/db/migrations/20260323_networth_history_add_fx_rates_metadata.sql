-- Add metadata JSONB to networth_history to store FX rates and pricing contexts used at recording time.
ALTER TABLE networth_history ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
