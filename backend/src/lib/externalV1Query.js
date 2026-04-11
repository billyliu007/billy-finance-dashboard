/** @param {Record<string, unknown>|undefined} query */
export function parseIncludeHistoricalSellsQuery(query) {
  const v = String(query?.includeHistoricalSells ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
