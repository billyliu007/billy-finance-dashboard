import PORTFOLIO_CONFIG from '../config/portfolioConfig.js';
import { parseMoney } from '../lib/number.js';
import { getCellValue } from '../lib/sheet.js';

export function buildPortfolioPayload({ headers = [], rows = [] }) {
  const positions = PORTFOLIO_CONFIG.assets.map((asset) => {
    const qtyRaw = getCellValue(headers, rows, asset.qtyCell);
    const purchasePriceRaw = getCellValue(headers, rows, asset.purchasePriceCell);
    const currentPriceRaw = getCellValue(headers, rows, asset.currentPriceCell);
    const qty = parseMoney(qtyRaw);
    const purchasePrice = parseMoney(purchasePriceRaw);
    const currentPrice = parseMoney(currentPriceRaw);
    const totalPurchaseCost = qty * purchasePrice;
    const currentValue = qty * currentPrice;
    const pnl = currentValue - totalPurchaseCost;
    const pnlPct = totalPurchaseCost === 0 ? 0 : (pnl / totalPurchaseCost) * 100;
    const found = [qtyRaw, purchasePriceRaw, currentPriceRaw].some((value) => String(value || '').trim() !== '');

    return {
      ...asset,
      found,
      qty,
      purchasePrice,
      currentPrice,
      totalPurchaseCost,
      currentValue,
      pnl,
      pnlPct,
    };
  });

  const visiblePositions = positions.filter((position) => position.found);
  const totals = visiblePositions.reduce(
    (acc, position) => {
      acc.cost += position.totalPurchaseCost;
      acc.value += position.currentValue;
      acc.pnl += position.pnl;
      return acc;
    },
    { cost: 0, value: 0, pnl: 0 },
  );

  const totalPnlPct = totals.cost === 0 ? 0 : (totals.pnl / totals.cost) * 100;
  const chartData = visiblePositions.map((position) => ({
    name: position.name,
    pnl: position.pnl,
    pnlPct: position.pnlPct,
  }));
  const allocationData = visiblePositions
    .filter((position) => position.currentValue > 0)
    .map((position) => ({ name: position.name, value: position.currentValue }));
  const tableRows = visiblePositions.map((position) => ({
    ...position,
    weightPct: totals.value === 0 ? 0 : (position.currentValue / totals.value) * 100,
  }));

  return {
    totals,
    totalPnlPct,
    chartData,
    allocationData,
    tableRows,
    isEmpty: visiblePositions.length === 0,
  };
}
