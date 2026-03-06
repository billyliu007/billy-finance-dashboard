import { parseMoney } from './formatters';

export const EMPTY_CASHFLOW_SUMMARY = {
  latest: { date: '-', netWorth: 0 },
  peak: { date: '-', netWorth: 0 },
  bottom: { date: '-', netWorth: 0 },
  latestPeriodChangePct: 0,
  latestPeriodSubtitle: '-',
};

export function parseCashflowRows(rows) {
  return rows
    .map((row) => ({
      date: String(row[0] || '').trim(),
      netWorth: parseMoney(row[1]),
    }))
    .filter((item) => item.date !== '' && item.netWorth !== 0);
}

export function buildDerivedChangeSeries(cashflowData) {
  return cashflowData.map((item, index) => {
    if (index === 0) {
      return { ...item, derivedChangePct: 0 };
    }

    const previous = cashflowData[index - 1];
    const derivedChangePct =
      previous.netWorth === 0 ? 0 : ((item.netWorth - previous.netWorth) / previous.netWorth) * 100;
    return { ...item, derivedChangePct };
  });
}

export function summarizeCashflow(cashflowData) {
  if (cashflowData.length === 0) {
    return EMPTY_CASHFLOW_SUMMARY;
  }

  const latest = cashflowData[cashflowData.length - 1];
  const peak = cashflowData.reduce((acc, item) => (item.netWorth > acc.netWorth ? item : acc), cashflowData[0]);
  const bottom = cashflowData.reduce((acc, item) => (item.netWorth < acc.netWorth ? item : acc), cashflowData[0]);
  const previous = cashflowData.length > 1 ? cashflowData[cashflowData.length - 2] : null;
  const latestPeriodChangePct = previous
    ? ((latest.netWorth - previous.netWorth) / previous.netWorth) * 100
    : 0;

  return {
    latest,
    peak,
    bottom,
    latestPeriodChangePct,
    latestPeriodSubtitle: previous ? `${previous.date} -> ${latest.date}` : latest.date,
  };
}
