-- Allow daily snapshots when USD is known but CNY/USD pivot is unavailable (no fabricated fallback).
ALTER TABLE networth_history
ALTER COLUMN total_cny DROP NOT NULL;
