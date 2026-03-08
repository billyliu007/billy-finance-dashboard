import PORTFOLIO_CONFIG from '../config/portfolioConfig.js';
import { parseMoney } from '../lib/number.js';
import { getCellValue } from '../lib/sheet.js';

function isStockAsset(asset) {
  return /stock/i.test(String(asset?.category || ''));
}

function isCryptoAsset(asset) {
  return /crypto/i.test(String(asset?.category || ''));
}

function resolveCurrentPrice(asset, currentPriceRaw, stockQuotes, cryptoQuotes) {
  if (!isStockAsset(asset) && !isCryptoAsset(asset)) {
    return {
      currentPrice: parseMoney(currentPriceRaw),
      priceSource: 'sheet',
      priceTimestamp: null,
    };
  }

  const symbol = String(asset?.name || '').trim().toUpperCase();
  const livePrice = isStockAsset(asset)
    ? Number(stockQuotes?.[symbol]?.price)
    : isCryptoAsset(asset)
      ? Number(cryptoQuotes?.[symbol]?.price)
      : NaN;
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return {
      currentPrice: null,
      priceSource: 'unavailable',
      priceTimestamp: null,
    };
  }

  return {
    currentPrice: livePrice,
    priceSource: isStockAsset(asset) ? 'finnhub' : String(cryptoQuotes?.[symbol]?.source || 'crypto-live'),
    priceTimestamp: isStockAsset(asset)
      ? Number(stockQuotes?.[symbol]?.timestamp) || null
      : Number(cryptoQuotes?.[symbol]?.timestamp) || null,
  };
}

export function buildPortfolioPayload({ headers = [], rows = [], stockQuotes = {}, cryptoQuotes = {} }) {
  const positions = PORTFOLIO_CONFIG.assets.map((asset) => {
    const qtyRaw = getCellValue(headers, rows, asset.qtyCell);
    const purchasePriceRaw = getCellValue(headers, rows, asset.purchasePriceCell);
    const currentPriceRaw = getCellValue(headers, rows, asset.currentPriceCell);
    const qty = parseMoney(qtyRaw);
    const purchasePrice = parseMoney(purchasePriceRaw);
    const priceResolution = resolveCurrentPrice(asset, currentPriceRaw, stockQuotes, cryptoQuotes);
    const currentPrice = Number.isFinite(priceResolution.currentPrice) ? priceResolution.currentPrice : 0;
    const totalPurchaseCost = qty * purchasePrice;
    const currentValue = qty * currentPrice;
    const pnl = currentValue - totalPurchaseCost;
    const pnlPct = totalPurchaseCost === 0 ? 0 : (pnl / totalPurchaseCost) * 100;
    const found = [qtyRaw, purchasePriceRaw].some((value) => String(value || '').trim() !== '');

    return {
      ...asset,
      found,
      qty,
      purchasePrice,
      currentPrice,
      priceSource: priceResolution.priceSource,
      priceTimestamp: priceResolution.priceTimestamp,
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
