/**
 * Shared position price resolution from stock/crypto quote maps.
 * Used by portfolioService (needs source/timestamp) and netWorthService (needs price only).
 */

import { isCryptoAsset, isStockAsset } from './assetUtils.js';

/**
 * Resolve current price for a position from quote maps.
 * @param {object} asset - Position with symbol, name, category
 * @param {object} stockQuotes - Map of symbol -> { price, source?, timestamp? }
 * @param {object} cryptoQuotes - Map of symbol -> { price, source?, timestamp? }
 * @returns {{ price: number | null, source?: string, timestamp?: number }}
 */
export function resolvePositionPrice(asset, stockQuotes = {}, cryptoQuotes = {}) {
  const symbol = String(asset?.symbol || asset?.name || '').trim().toUpperCase();
  if (isStockAsset(asset)) {
    const quote = stockQuotes?.[symbol];
    const price = quote != null ? Number(quote.price) : null;
    if (price == null || !Number.isFinite(price) || price <= 0) {
      return { price: null, source: 'unavailable', timestamp: null };
    }
    return {
      price,
      source: String(quote?.source || 'finnhub'),
      timestamp: Number(quote?.timestamp) || null,
    };
  }
  if (isCryptoAsset(asset)) {
    const quote = cryptoQuotes?.[symbol];
    const price = quote != null ? Number(quote.price) : null;
    if (price == null || !Number.isFinite(price) || price <= 0) {
      return { price: null, source: 'unavailable', timestamp: null };
    }
    return {
      price,
      source: String(quote?.source || 'crypto-live'),
      timestamp: Number(quote?.timestamp) || null,
    };
  }
  const fallback = Number(asset?.purchasePrice);
  return {
    price: Number.isFinite(fallback) && fallback >= 0 ? fallback : null,
    source: 'unavailable',
    timestamp: null,
  };
}
