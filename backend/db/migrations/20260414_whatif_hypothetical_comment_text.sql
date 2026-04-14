-- Optional per-line notes for simulated buys/sells (what-if scenarios).
ALTER TABLE whatif_hypothetical_purchases
  ADD COLUMN IF NOT EXISTS comment_text TEXT;

ALTER TABLE whatif_hypothetical_sales
  ADD COLUMN IF NOT EXISTS comment_text TEXT;
