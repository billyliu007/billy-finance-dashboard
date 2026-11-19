import { ApiError } from '../lib/ApiError.js';
import * as financeRepo from '../repositories/financeRepository.js';

/**
 * Record a stock/crypto BUY or SELL for a user (external API: POST /api/v1/me/trades).
 *
 * - BUY of an asset the user doesn't hold yet: the asset is created first with a 0 initial
 *   holding, then the purchase is recorded as a transaction (removed again if that fails).
 * - SELL: rejected with `insufficient_holding` when qty exceeds the current holding.
 * - Crypto BUY accepts two input styles (same as the web UI):
 *     1. unit price:   qty + pricePerUnit (+ optional flat fee in the quote currency)
 *     2. total amount: qty received (gross) + totalAmount spent (+ optional feeInCrypto);
 *        net qty = qty - feeInCrypto, price per unit = totalAmount / net qty.
 * Holdings math, cash linking and the oversell check reuse createPositionTransaction.
 */

const EPSILON = 1e-12;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STABLE_QUOTES = ['USDT', 'USDC'];

function bad(message, code, details) {
  return new ApiError(message, 400, { code, details });
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number.`, 'invalid_number', { field });
  return n;
}

function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isCryptoCategory(category) {
  return /crypto/i.test(String(category || ''));
}

/**
 * Validate and normalize the request body. Pure; throws ApiError(400) with a `code`.
 * @returns {{ assetType: 'stock'|'crypto', side: 'BUY'|'SELL', symbol: string, txDate: string,
 *   qty: number, pricePerUnit: number, fee: number|null, inputMode: 'unit'|'total',
 *   grossQty: number|null, totalAmount: number|null, feeInCrypto: number|null,
 *   quoteCurrency: string|null, cashAccountId: string|null, notes: string|null }}
 */
export function parseTradeRequest(body = {}, { now = new Date() } = {}) {
  const assetType = String(body.assetType || '').trim().toLowerCase();
  if (assetType !== 'stock' && assetType !== 'crypto') {
    throw bad('assetType must be "stock" or "crypto".', 'invalid_asset_type');
  }
  const sideRaw = String(body.side || '').trim().toUpperCase();
  if (sideRaw !== 'BUY' && sideRaw !== 'SELL') {
    throw bad('side must be "buy" or "sell".', 'invalid_side');
  }
  const side = sideRaw;

  const symbol = String(body.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) {
    throw bad('symbol is required (e.g. "AAPL" or "BTC").', 'invalid_symbol');
  }

  const txDate = body.date == null || body.date === '' ? todayUtc(now) : String(body.date).trim();
  const parsedDate = new Date(`${txDate}T00:00:00Z`);
  if (!DATE_PATTERN.test(txDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== txDate) {
    throw bad('date must be YYYY-MM-DD.', 'invalid_date');
  }
  if (parsedDate.getTime() > now.getTime() + 24 * 3600 * 1000) {
    throw bad('date cannot be in the future.', 'invalid_date');
  }

  const qty = optionalNumber(body.qty, 'qty');
  if (qty == null || qty <= 0) throw bad('qty must be greater than 0.', 'invalid_qty');

  const pricePerUnitInput = optionalNumber(body.pricePerUnit ?? body.price, 'pricePerUnit');
  const totalAmount = optionalNumber(body.totalAmount, 'totalAmount');
  const feeInCryptoInput = optionalNumber(body.feeInCrypto, 'feeInCrypto');
  const feeInput = optionalNumber(body.fee, 'fee');

  let inputMode = 'unit';
  let netQty = qty;
  let pricePerUnit = pricePerUnitInput;
  let fee = feeInput;
  let feeInCrypto = null;

  if (totalAmount != null) {
    if (assetType !== 'crypto' || side !== 'BUY') {
      throw bad('totalAmount is only supported for crypto buys.', 'invalid_input_mode');
    }
    if (pricePerUnitInput != null) {
      throw bad('Send either pricePerUnit or totalAmount, not both.', 'invalid_input_mode');
    }
    if (feeInput != null) {
      throw bad('With totalAmount, give the fee as feeInCrypto (the flat fee is already in the total).', 'invalid_input_mode');
    }
    if (totalAmount <= 0) throw bad('totalAmount must be greater than 0.', 'invalid_total_amount');
    feeInCrypto = feeInCryptoInput ?? 0;
    if (feeInCrypto < 0) throw bad('feeInCrypto must be 0 or greater.', 'invalid_fee');
    netQty = qty - feeInCrypto;
    if (netQty <= EPSILON) throw bad('feeInCrypto must be less than qty.', 'invalid_fee');
    inputMode = 'total';
    pricePerUnit = totalAmount / netQty;
    fee = null; // already part of totalAmount / netted out of qty
  } else {
    if (feeInCryptoInput != null) {
      throw bad('feeInCrypto is only used with totalAmount.', 'invalid_input_mode');
    }
    if (pricePerUnit == null || pricePerUnit < 0) {
      throw bad('pricePerUnit is required and must be 0 or greater (or use totalAmount for crypto buys).', 'invalid_price');
    }
    if (fee != null && fee < 0) throw bad('fee must be 0 or greater.', 'invalid_fee');
  }

  const quoteCurrency = body.quoteCurrency == null || body.quoteCurrency === ''
    ? null
    : String(body.quoteCurrency).trim().toUpperCase();
  if (quoteCurrency && (assetType !== 'crypto' || !STABLE_QUOTES.includes(quoteCurrency))) {
    throw bad('quoteCurrency must be USDT or USDC (crypto only).', 'invalid_quote_currency');
  }

  const cashAccountId = body.cashAccountId ? String(body.cashAccountId).trim() : null;
  const notes = body.notes == null ? null : String(body.notes).trim().slice(0, 500) || null;

  return {
    assetType,
    side,
    symbol,
    txDate,
    qty: netQty,
    pricePerUnit,
    fee,
    inputMode,
    grossQty: inputMode === 'total' ? qty : null,
    totalAmount: inputMode === 'total' ? totalAmount : null,
    feeInCrypto: inputMode === 'total' ? feeInCrypto : null,
    quoteCurrency,
    cashAccountId,
    notes,
  };
}

function pickCryptoProduct(products, quoteCurrency) {
  if (quoteCurrency) {
    return products.find((p) => String(p.quoteCurrency).toUpperCase() === quoteCurrency) || null;
  }
  for (const quote of STABLE_QUOTES) {
    const match = products.find((p) => String(p.quoteCurrency).toUpperCase() === quote);
    if (match) return match;
  }
  return null;
}

function roundQty(n) {
  return Math.round(n * 1e10) / 1e10;
}

/**
 * Factory so tests can inject a fake repository.
 */
export function createTradeService({ repo = financeRepo } = {}) {
  async function createAssetForBuy(userId, trade) {
    if (trade.assetType === 'stock') {
      const known = await repo.findUsStockSymbol(trade.symbol);
      if (!known) {
        throw new ApiError(`Unknown US stock symbol: ${trade.symbol}.`, 404, { code: 'unknown_symbol' });
      }
      await repo.createStockPositionFromSymbol({ userId, symbol: trade.symbol, qty: 0, avgCostPerUnit: 0 });
      return;
    }
    const products = await repo.listCoinbaseStableProductsForBase(trade.symbol);
    const product = pickCryptoProduct(products, trade.quoteCurrency);
    if (!product) {
      const which = trade.quoteCurrency ? `${trade.symbol}-${trade.quoteCurrency}` : `${trade.symbol}-USDT or ${trade.symbol}-USDC`;
      throw new ApiError(`No Coinbase market found for ${which}.`, 404, { code: 'unknown_symbol' });
    }
    await repo.createCryptoPositionFromCoinbaseProduct({
      userId,
      productId: product.productId,
      qty: 0,
      avgCostPerUnit: 0,
    });
  }

  async function recordTrade(userId, body, options = {}) {
    if (!userId) throw new ApiError('Authentication required.', 401);
    const trade = parseTradeRequest(body, options);

    const before = await repo.getPositionHolding(userId, trade.symbol);
    if (before && isCryptoCategory(before.category) !== (trade.assetType === 'crypto')) {
      throw bad(
        `${trade.symbol} is held as ${isCryptoCategory(before.category) ? 'crypto' : 'a stock'}, not ${trade.assetType}.`,
        'asset_type_mismatch',
      );
    }

    if (trade.side === 'SELL') {
      const held = before ? Math.max(0, before.qty) : 0;
      if (trade.qty > held + EPSILON) {
        throw bad(
          `Cannot sell ${trade.qty} ${trade.symbol}: you hold ${roundQty(held)}.`,
          'insufficient_holding',
          { held: roundQty(held), requested: trade.qty },
        );
      }
    }

    let assetCreated = false;
    if (trade.side === 'BUY' && !before) {
      await createAssetForBuy(userId, trade);
      assetCreated = true;
    }

    try {
      await repo.createPositionTransaction({
        userId,
        symbol: trade.symbol,
        txDate: trade.txDate,
        qty: trade.qty,
        avgCostPerUnit: trade.pricePerUnit,
        type: trade.side,
        feeFlatTotal: trade.fee,
        notes: trade.notes,
        deductCashId: trade.side === 'BUY' ? trade.cashAccountId : null,
        creditCashId: trade.side === 'SELL' ? trade.cashAccountId : null,
      });
    } catch (error) {
      // Don't leave an empty placeholder asset behind when the purchase itself failed.
      if (assetCreated) {
        await repo.deletePosition(userId, trade.symbol).catch(() => {});
      }
      const message = String(error?.message || 'Could not record the trade.');
      if (/exceeds current holding|No available quantity/i.test(message)) {
        throw bad(`Cannot sell ${trade.qty} ${trade.symbol}: not enough held.`, 'insufficient_holding');
      }
      throw bad(message, 'trade_rejected');
    }

    const after = await repo.getPositionHolding(userId, trade.symbol);
    return {
      ok: true,
      assetCreated,
      trade: {
        assetType: trade.assetType,
        side: trade.side.toLowerCase(),
        symbol: trade.symbol,
        date: trade.txDate,
        qty: trade.qty,
        pricePerUnit: trade.pricePerUnit,
        fee: trade.fee,
        inputMode: trade.inputMode,
        ...(trade.inputMode === 'total'
          ? { grossQty: trade.grossQty, totalAmount: trade.totalAmount, feeInCrypto: trade.feeInCrypto }
          : {}),
        cashAccountId: trade.cashAccountId,
        notes: trade.notes,
      },
      holding: after
        ? { symbol: after.symbol, currency: after.currency, qty: roundQty(after.qty), avgCost: after.avgCost }
        : null,
    };
  }

  return { recordTrade };
}
