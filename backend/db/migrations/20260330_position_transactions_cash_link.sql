-- Link position transactions to the cash item used for deduction/credit.
-- This enables reversing cash effects when deleting a BUY/SELL.

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS deduct_cash_id UUID REFERENCES cash (id) ON DELETE SET NULL;

ALTER TABLE portfolio_position_transactions
ADD COLUMN IF NOT EXISTS credit_cash_id UUID REFERENCES cash (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_deduct_cash_id
ON portfolio_position_transactions (deduct_cash_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_position_tx_credit_cash_id
ON portfolio_position_transactions (credit_cash_id);

