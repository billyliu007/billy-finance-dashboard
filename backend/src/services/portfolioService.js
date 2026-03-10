import PORTFOLIO_CONFIG from '../config/portfolioConfig.js';

function isNonPositiveOrInvalidQuantity(value) {
  const num = Number(value);
  return !Number.isFinite(num) || num <= 0;
}

function isStockAsset(asset) {
  return /stock/i.test(String(asset?.category || ''));
}

function isCryptoAsset(asset) {
  return /crypto/i.test(String(asset?.category || ''));
}

function resolveCurrentPrice(asset, stockQuotes, cryptoQuotes) {
  const symbol = String(asset?.symbol || asset?.name || '').trim().toUpperCase();
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
    priceSource: isStockAsset(asset)
      ? String(stockQuotes?.[symbol]?.source || 'finnhub')
      : String(cryptoQuotes?.[symbol]?.source || 'crypto-live'),
    priceTimestamp: isStockAsset(asset)
      ? Number(stockQuotes?.[symbol]?.timestamp) || null
      : Number(cryptoQuotes?.[symbol]?.timestamp) || null,
  };
}

export function buildPortfolioPayload({ positions = [], stockQuotes = {}, cryptoQuotes = {} }) {
  const configuredAssetMap = new Map(
    (PORTFOLIO_CONFIG.assets || []).map((asset) => [String(asset.name || '').toUpperCase(), asset]),
  );
  const normalized = positions.map((position) => {
    const symbol = String(position?.symbol || '').toUpperCase();
    const configured = configuredAssetMap.get(symbol) || {};
    return {
      ...configured,
      symbol,
      name: position?.name || configured?.name || symbol,
      category: position?.category || configured?.category || 'Other',
      qty: Number(position?.qty || 0),
      purchasePrice: Number(position?.purchasePrice || 0),
    };
  });

  const computedPositions = normalized.map((asset) => {
    const priceResolution = resolveCurrentPrice(asset, stockQuotes, cryptoQuotes);
    const currentPrice = Number.isFinite(priceResolution.currentPrice) ? priceResolution.currentPrice : 0;
    const totalPurchaseCost = asset.qty * asset.purchasePrice;
    const currentValue = asset.qty * currentPrice;
    const pnl = currentValue - totalPurchaseCost;
    const pnlPct = totalPurchaseCost === 0 ? 0 : (pnl / totalPurchaseCost) * 100;
    const found =
      !isNonPositiveOrInvalidQuantity(asset.qty) &&
      (Number.isFinite(asset.qty) || Number.isFinite(asset.purchasePrice));

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
  });

  const visiblePositions = computedPositions.filter((position) => position.found);
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
