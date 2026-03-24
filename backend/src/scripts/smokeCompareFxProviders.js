/**
 * One-off smoke: compare Frankfurter vs open.er-api for the same currency set
 * the cron uses (defaults + optional extra cash codes from argv).
 * Usage: node src/scripts/smokeCompareFxProviders.js [EXTRA,EXTRA,...]
 * Example: node src/scripts/smokeCompareFxProviders.js AUD CHF
 */
import { fetchFrankfurterFxRates, fetchOpenErApiFxRates } from '../lib/fx.js';

const extras = process.argv.slice(2).map((c) => String(c).trim().toUpperCase()).filter(Boolean);

const [frank, openEr] = await Promise.all([
  fetchFrankfurterFxRates(extras),
  fetchOpenErApiFxRates(extras),
]);

const codes = [...new Set([...Object.keys(frank), ...Object.keys(openEr)])]
  .filter((c) => c !== 'USD')
  .sort();

const rows = codes.map((code) => {
  const a = Number(frank[code]);
  const b = Number(openEr[code]);
  const hasA = Number.isFinite(a) && a > 0;
  const hasB = Number.isFinite(b) && b > 0;
  let pct = '';
  let absDiff = '';
  if (hasA && hasB) {
    const d = Math.abs(a - b);
    absDiff = d.toExponential(4);
    pct = `${((d / ((a + b) / 2)) * 100).toFixed(4)}%`;
  } else if (!hasA && !hasB) {
    absDiff = 'both missing';
  } else {
    absDiff = hasA ? 'open.er missing' : 'frankfurter missing';
  }
  return {
    code,
    frankfurter: hasA ? a.toExponential(8) : '—',
    openErApi: hasB ? b.toExponential(8) : '—',
    absMidPct: pct || '—',
    note: absDiff,
  };
});

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      extrasRequested: extras.length ? extras : '(none — defaults only)',
      summary: {
        frankfurterKeys: Object.keys(frank).length,
        openErKeys: Object.keys(openEr).length,
        comparedCodes: codes.length,
      },
      ratesUsdPerOneUnit: rows,
    },
    null,
    2,
  ),
);
