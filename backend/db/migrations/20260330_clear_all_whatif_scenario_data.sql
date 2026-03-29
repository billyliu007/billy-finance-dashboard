-- One-time wipe of scenario planning data (what-if).
-- Child rows (target prices, hypothetical buys/sales) are removed via ON DELETE CASCADE.

DELETE FROM whatif_scenarios;
