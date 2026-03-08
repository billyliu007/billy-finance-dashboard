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

export async function fetchFrankfurterFxRates() {
  const [usdToCny, sgdToCny] = await Promise.all([
    fetchPair('USD', 'CNY'),
    fetchPair('SGD', 'CNY'),
  ]);

  const rates = {};
  if (usdToCny) {
    rates.USD = usdToCny;
  }
  if (sgdToCny) {
    rates.SGD = sgdToCny;
  }
  return rates;
}
