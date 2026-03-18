import PORTFOLIO_CONFIG from '../config/portfolioConfig.js';
import { isCryptoAsset, isStockAsset } from '../lib/assetUtils.js';
import { resolvePositionPrice } from '../lib/priceResolution.js';

function isNonPositiveOrInvalidQuantity(value) {
  const num = Number(value);
  // 0 is allowed for placeholder positions (e.g. for importing realized history later).
  return !Number.isFinite(num) || num < 0;
}

function resolveCurrentPrice(asset, stockQuotes, cryptoQuotes) {
  const { price, source, timestamp } = resolvePositionPrice(asset, stockQuotes, cryptoQuotes);
  return {
    currentPrice: price,
    priceSource: source ?? 'unavailable',
    priceTimestamp: timestamp ?? null,
  };
}

function normalizePositionsWithConfig(positions, configuredAssetMap) {
  return positions.map((position) => {
    const symbol = String(position?.symbol || '').toUpperCase();
    const configured = configuredAssetMap.get(symbol) || {};
    const category = position?.category || configured?.category || 'Other';
    const currency =
      position?.currency && String(position.currency).trim()
        ? String(position.currency).trim().toUpperCase()
        : isStockAsset({ category })
          ? 'USD'
          : 'USD';
    return {
      ...configured,
      // Preserve any precomputed fields from dashboardService (base holding + tx rollups).
      baseQty: position?.baseQty != null ? Number(position.baseQty) : undefined,
      baseAvgCost: position?.baseAvgCost != null ? Number(position.baseAvgCost) : undefined,
      baseCost: position?.baseCost != null ? Number(position.baseCost) : undefined,
      buyQty: position?.buyQty != null ? Number(position.buyQty) : undefined,
      buyCost: position?.buyCost != null ? Number(position.buyCost) : undefined,
      sellQty: position?.sellQty != null ? Number(position.sellQty) : undefined,
      sellCost: position?.sellCost != null ? Number(position.sellCost) : undefined,
      realizedPnl: position?.realizedPnl != null ? Number(position.realizedPnl) : undefined,
      totalQty: position?.totalQty != null ? Number(position.totalQty) : undefined,
      totalCost: position?.totalCost != null ? Number(position.totalCost) : undefined,
      totalAvgCost: position?.totalAvgCost != null ? Number(position.totalAvgCost) : undefined,
      symbol,
      name: position?.name || configured?.name || symbol,
      category,
      currency,
      qty: Number(position?.qty || 0),
      purchasePrice: Number(position?.purchasePrice || 0),
    };
  });
}

function computePositionMetrics(asset, priceResolution) {
  const currentPrice = Number.isFinite(priceResolution.currentPrice) ? priceResolution.currentPrice : 0;
  const totalPurchaseCost = asset.qty * asset.purchasePrice;
  const currentValue = asset.qty * currentPrice;
  const pnl = currentValue - totalPurchaseCost;
  const pnlPct = totalPurchaseCost === 0 ? 0 : (pnl / totalPurchaseCost) * 100;
  const realizedPnl = Number(asset?.realizedPnl) || 0;
  const realizedCost = Number(asset?.sellCost) || 0;
  const found =
    (!isNonPositiveOrInvalidQuantity(asset.qty) &&
      (Number.isFinite(asset.qty) || Number.isFinite(asset.purchasePrice))) ||
    Math.abs(realizedPnl) > 1e-12 ||
    realizedCost > 1e-12;
  return {
    ...asset,
    found,
    qty: asset.qty,
    purchasePrice: asset.purchasePrice,
    currentPrice,
    priceSource: priceResolution.priceSource,
    priceTimestamp: priceResolution.priceTimestamp,
    totalPurchaseCost,
    currentValue,
    pnl,
    pnlPct,
  };
}

function aggregateTotals({ visiblePositions, allPositions }) {
  const totals = visiblePositions.reduce(
    (acc, position) => {
      acc.cost += position.totalPurchaseCost;
      acc.value += position.currentValue;
      acc.pnl += position.pnl;
      return acc;
    },
    { cost: 0, value: 0, pnl: 0, realizedPnl: 0, realizedCost: 0 },
  );
  for (const position of allPositions) {
    totals.realizedPnl += Number(position?.realizedPnl) || 0;
    totals.realizedCost += Number(position?.sellCost) || 0;
  }
  return totals;
}

/**
 * Build the portfolio dashboard payload from positions and live quotes.
 * @param {object} options
 * @param {object[]} options.positions
 * @param {object} options.stockQuotes
 * @param {object} options.cryptoQuotes
 * @returns {{ totals: object, totalPnlPct: number, chartData: object[], allocationData: object[], tableRows: object[], isEmpty: boolean }}
 */
export function buildPortfolioPayload({ positions = [], stockQuotes = {}, cryptoQuotes = {} }) {
  const configuredAssetMap = new Map(
    (PORTFOLIO_CONFIG.assets || []).map((asset) => [String(asset.name || '').toUpperCase(), asset]),
  );
  const normalized = normalizePositionsWithConfig(positions, configuredAssetMap);
  const computedPositions = normalized.map((asset) => {
    const priceResolution = resolveCurrentPrice(asset, stockQuotes, cryptoQuotes);
    return computePositionMetrics(asset, priceResolution);
  });
  const visiblePositions = computedPositions.filter((position) => position.found);
  const totals = aggregateTotals({ visiblePositions, allPositions: computedPositions });
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
    key: position.symbol,
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
