/** Shared YYYY-MM-DD helpers (trading timeframe UI, AI fab). */

export function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

export function startOfYearDateOnly() {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

export function subtractMonthsDateOnly(dateOnly, months) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
