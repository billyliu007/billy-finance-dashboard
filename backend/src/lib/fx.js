const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';

function parseRate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function fetchPair(from, to) {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`${FRANKFURTER_URL}?${params.toString()}`);
  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  return parseRate(body?.rates?.[to]);
}

/** Currencies we always fetch to CNY (plus any passed in). */
const DEFAULT_FX_CURRENCIES = ['USD', 'SGD', 'EUR', 'GBP', 'JPY', 'HKD'];

export async function fetchFrankfurterFxRates(extraCurrencies = []) {
  const toFetch = [...new Set([...DEFAULT_FX_CURRENCIES, ...extraCurrencies])].filter(
    (c) => c !== 'CNY'
  );
  const pairs = await Promise.all(
    toFetch.map((currency) => fetchPair(currency, 'CNY').then((rate) => ({ currency, rate })))
  );

  const rates = {};
  for (const { currency, rate } of pairs) {
    if (rate != null) {
      rates[currency] = rate;
    }
  }
  return rates;
}
