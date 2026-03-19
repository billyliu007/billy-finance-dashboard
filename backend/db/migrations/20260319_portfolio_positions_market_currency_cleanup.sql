-- Portfolio positions: add market resolution metadata, normalize categories, and ensure currency is set.

ALTER TABLE portfolio_positions
ADD COLUMN IF NOT EXISTS market_provider TEXT;

ALTER TABLE portfolio_positions
ADD COLUMN IF NOT EXISTS market_instrument_id TEXT;

UPDATE portfolio_positions
SET market_provider = 'coinbase',
    market_instrument_id = CASE UPPER(symbol)
      WHEN 'BTC' THEN 'BTC-USDT'
      WHEN 'ETH' THEN 'ETH-USDT'
      ELSE market_instrument_id
    END
WHERE category ILIKE '%crypto%'
  AND market_provider IS NULL;

ALTER TABLE portfolio_positions
DROP COLUMN IF EXISTS display_name;

UPDATE portfolio_positions
SET category = 'US Stock Assets'
WHERE category = 'Stock Assets';

ALTER TABLE portfolio_positions
ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE portfolio_positions
SET currency = 'USD'
WHERE (category ILIKE '%stock%' OR category = 'US Stock Assets')
  AND (currency IS NULL OR currency = '');

UPDATE portfolio_positions pp
SET currency = COALESCE(cp.quote_currency, 'USD')
FROM coinbase_products cp
WHERE pp.market_instrument_id = cp.product_id
  AND pp.category ILIKE '%crypto%'
  AND (pp.currency IS NULL OR pp.currency = '');

UPDATE portfolio_positions
SET currency = 'USD'
WHERE currency IS NULL OR currency = '';

