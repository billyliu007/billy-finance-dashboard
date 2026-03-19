-- Currencies seed + legacy cash_components -> cash migration (dynamic, idempotent).

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed currencies (upsert).
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('AUD', 'Australian Dollar'),
      ('BRL', 'Brazilian Real'),
      ('CAD', 'Canadian Dollar'),
      ('CHF', 'Swiss Franc'),
      ('CNY', 'Chinese Renminbi Yuan'),
      ('CZK', 'Czech Koruna'),
      ('DKK', 'Danish Krone'),
      ('EUR', 'Euro'),
      ('GBP', 'British Pound'),
      ('HKD', 'Hong Kong Dollar'),
      ('HUF', 'Hungarian Forint'),
      ('IDR', 'Indonesian Rupiah'),
      ('ILS', 'Israeli New Sheqel'),
      ('INR', 'Indian Rupee'),
      ('ISK', 'Icelandic Króna'),
      ('JPY', 'Japanese Yen'),
      ('KRW', 'South Korean Won'),
      ('MXN', 'Mexican Peso'),
      ('MYR', 'Malaysian Ringgit'),
      ('NOK', 'Norwegian Krone'),
      ('NZD', 'New Zealand Dollar'),
      ('PHP', 'Philippine Peso'),
      ('PLN', 'Polish Złoty'),
      ('RON', 'Romanian Leu'),
      ('SEK', 'Swedish Krona'),
      ('SGD', 'Singapore Dollar'),
      ('THB', 'Thai Baht'),
      ('TRY', 'Turkish Lira'),
      ('USD', 'United States Dollar'),
      ('USDT', 'Tether'),
      ('USDC', 'USD Coin'),
      ('ZAR', 'South African Rand')
    ) AS t(code, name)
  LOOP
    INSERT INTO currencies (code, name, active, updated_at)
    VALUES (rec.code, rec.name, true, NOW())
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name, updated_at = NOW();
  END LOOP;
END $$;

-- Migrate legacy cash_components table to cash.
DO $$
DECLARE
  has_old_table BOOLEAN;
  has_name BOOLEAN;
  has_display_name BOOLEAN;
  has_balance BOOLEAN;
  has_amount BOOLEAN;
  has_component_type BOOLEAN;
  has_updated_at BOOLEAN;
  name_expr TEXT;
  balance_expr TEXT;
  updated_expr TEXT;
  insert_sql TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cash_components'
  ) INTO has_old_table;

  IF NOT has_old_table THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS cash (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    currency TEXT NOT NULL,
    name TEXT NOT NULL,
    balance NUMERIC(20, 6) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_components' AND column_name = 'name'
  ) INTO has_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_components' AND column_name = 'display_name'
  ) INTO has_display_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_components' AND column_name = 'balance'
  ) INTO has_balance;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_components' AND column_name = 'amount'
  ) INTO has_amount;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_components' AND column_name = 'component_type'
  ) INTO has_component_type;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cash_components' AND column_name = 'updated_at'
  ) INTO has_updated_at;

  IF has_name THEN
    name_expr := 'TRIM(COALESCE(name, ''Cash''))';
  ELSIF has_display_name THEN
    name_expr := 'TRIM(COALESCE(display_name, ''Cash''))';
  ELSE
    name_expr := '''Cash''';
  END IF;

  IF has_balance AND NOT has_amount THEN
    balance_expr := 'balance';
  ELSIF has_amount AND has_component_type THEN
    balance_expr := 'CASE WHEN component_type = ''liability'' THEN -ABS(amount) ELSE amount END';
  ELSIF has_amount THEN
    balance_expr := 'amount';
  ELSIF has_balance THEN
    balance_expr := 'balance';
  ELSE
    balance_expr := '0';
  END IF;

  IF has_updated_at THEN
    updated_expr := 'updated_at';
  ELSE
    updated_expr := 'NOW()';
  END IF;

  insert_sql := format(
    'INSERT INTO cash (id, user_id, currency, name, balance, updated_at)
     SELECT id, user_id, UPPER(TRIM(currency)), %s, %s, COALESCE(%s, NOW())
     FROM cash_components',
    name_expr, balance_expr, updated_expr
  );

  EXECUTE insert_sql;
  EXECUTE 'DROP TABLE cash_components';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_cash_user_id ON cash (user_id)';
END $$;

