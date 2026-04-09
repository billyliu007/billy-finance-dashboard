import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { deleteJson, fetchJson, postJson, putJson } from '../utils/api.js';
import { useLanguage } from '../contexts/LanguageContext.jsx';
import { useDashboard } from '../contexts/DashboardContext.jsx';
import { formatCurrencyValue, formatMoney, formatPercent, formatQty } from '../utils/formatters.js';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js';
import { normalizeText, sanitizeDecimalInput } from '../utils/strings.js';
import './WhatIfScenariosPage.css';

function cloneSyncedTargetRows(rows) {
  return (rows || []).map((r) => ({
    symbol: String(r?.symbol || '').trim().toUpperCase(),
    targetPrice: r.targetPrice,
    targetPrice2: r.targetPrice2,
    currency: r.currency ?? '',
  }));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Controlled target price fields: preserve partial decimals (e.g. "0.") while typing.
 * Using num("0.") yields 0 and the trailing dot is lost on the next render, so values like 0.9 cannot be entered.
 */
function coerceTargetPriceInputValue(raw) {
  if (raw === '' || raw == null) return '';
  const s = String(raw);
  if (s === '.' || s === '-' || s === '-.') return s;
  if (s.endsWith('.')) return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

/** Same as `computeInputsHash([], [], [])` for empty editor state. */
const EMPTY_WHATIF_INPUTS_HASH = JSON.stringify({ targetRows: [], purchaseRows: [], saleRows: [] });

/** Default sell-price text from portfolio row market price (dashboard live quote). */
function marketPriceDefaultStringForSymbol(tableRows, symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return '';
  const row = (tableRows || []).find((r) => String(r.symbol || '').trim().toUpperCase() === sym);
  const p = num(row?.currentPrice);
  if (!(p > 0)) return '';
  let s = p.toFixed(8);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}

/** Match RecordSaleModal: floor qty at 8 dp so slider % does not overshoot max sellable. */
function roundDownSellQty(value, decimals = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.floor(n * factor) / factor;
}

/** Same positive-target rule as `computeInputsHash` target slice: only prices > 0 count. */
function normalizedPositiveTargetFromRows(rows, symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const row = (rows || []).find((x) => String(x?.symbol || '').trim().toUpperCase() === sym);
  const p = num(row?.targetPrice);
  return p > 0 ? p : null;
}

function normalizedPositiveTarget2FromRows(rows, symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const row = (rows || []).find((x) => String(x?.symbol || '').trim().toUpperCase() === sym);
  const p = num(row?.targetPrice2);
  return p > 0 ? p : null;
}

/** Rebuild TP2 % inputs from target rows and scenario result rows (baseline price). */
function buildTargetPrice2PctMap(targetRows, baselineRows) {
  const pct2 = {};
  for (const row of baselineRows || []) {
    const sym = String(row.symbol || '').toUpperCase();
    if (!sym) continue;
    const tr = (targetRows || []).find((x) => String(x.symbol).toUpperCase() === sym);
    const baseline = num(row.baselinePrice);
    const t2 = num(tr?.targetPrice2);
    pct2[sym] = baseline > 0 && t2 > 0 ? (((t2 - baseline) / baseline) * 100).toFixed(2) : '';
  }
  return pct2;
}

function formatPriceNumber(value, currency = 'USD') {
  const code = String(currency || 'USD').trim().toUpperCase();
  const locale = code === 'CNY' || code === 'RMB' ? 'zh-CN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(num(value));
}

/** USD, USDT, USDC share $ in target-price simulation UI; other codes use Intl narrow symbol. */
function targetSimulationCurrencyPrefix(currency) {
  const c = String(currency || 'USD').trim().toUpperCase();
  if (c === 'USD' || c === 'USDT' || c === 'USDC') return '$';
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: c,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? '';
  } catch {
    return '';
  }
}

function emptyStockForm() {
  return { query: '', selectedSymbol: '', qty: '', buyPrice: '' };
}

function emptyCryptoForm() {
  return { query: '', selectedProductId: '', qty: '', buyPrice: '' };
}

function inferAssetClass(row) {
  const currency = String(row?.currency || '').trim().toUpperCase();
  if (currency === 'USDT' || currency === 'USDC') return 'crypto';
  return 'stock';
}

/** Prefer portfolio row category for stock vs crypto (aligns with dashboard table). */
function holdingAssetClass(row) {
  if (/crypto/i.test(String(row?.category || ''))) return 'crypto';
  if (/stock/i.test(String(row?.category || ''))) return 'stock';
  return inferAssetClass(row);
}

function hypotheticalBuyQuoteCurrency(row) {
  if (row?.assetClass === 'stock') return 'USD';
  return String(row?.currency || 'USD').trim().toUpperCase() || 'USD';
}

/** USDT/USDC treated as USD for “Totals by asset” so stablecoin lines merge per symbol. */
function aggregateHypotheticalQuoteBucket(quoteCode) {
  const c = String(quoteCode || 'USD').trim().toUpperCase() || 'USD';
  if (c === 'USDT' || c === 'USDC') return 'USD';
  return c;
}

/** One row per (symbol, quote bucket): summed qty, cost, and volume-weighted avg price. */
function aggregateHypotheticalBuyRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const sym = String(row?.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    const q = num(row.qty);
    if (!(q > 0)) continue;
    const quoteCcy = hypotheticalBuyQuoteCurrency(row);
    const bucketCcy = aggregateHypotheticalQuoteBucket(quoteCcy);
    const key = `${sym}\0${bucketCcy}`;
    const lineCost = q * num(row.buyPrice);
    if (!Number.isFinite(lineCost)) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { symbol: sym, currency: bucketCcy, totalQty: q, totalCost: lineCost });
    } else {
      prev.totalQty += q;
      prev.totalCost += lineCost;
    }
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      avgCost: r.totalQty > 0 ? r.totalCost / r.totalQty : 0,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Stable key for grouping buy lines with `aggregateHypotheticalBuyRows`. */
function hypoBuyAggregateKey(row) {
  const sym = String(row?.symbol || '').trim().toUpperCase();
  if (!sym) return '';
  const quoteCcy = hypotheticalBuyQuoteCurrency(row);
  const bucketCcy = aggregateHypotheticalQuoteBucket(quoteCcy);
  return `${sym}\0${bucketCcy}`;
}

/** Grouping key for hypothetical sell rows (same as legacy aggregate totals). */
function hypoSellAggregateKey(row) {
  const sym = String(row?.symbol || '').trim().toUpperCase();
  if (!sym) return '';
  const quoteCcy = row?.assetClass === 'stock' ? 'USD' : String(row?.currency || 'USD').trim().toUpperCase() || 'USD';
  const bucketCcy = aggregateHypotheticalQuoteBucket(quoteCcy);
  return `${sym}\0${bucketCcy}`;
}

/**
 * Per-(symbol, quote) rollups: weighted avg sell & cost, summed proceeds, realized P/L and return %.
 * `metricsByIndex` must align with `sellRows` (from `hypotheticalSellRowMetricsSequence`).
 */
function buildAggregatedHypotheticalSellSummary(sellRows, metricsByIndex) {
  const map = new Map();
  (sellRows || []).forEach((row, index) => {
    const key = hypoSellAggregateKey(row);
    if (!key) return;
    const q = num(row.qty);
    if (!(q > 0)) return;
    const m = Array.isArray(metricsByIndex) ? metricsByIndex[index] : null;
    const proceeds = m?.proceeds ?? Math.max(0, q * num(row.sellPrice));
    const costPu = m?.costPerUnit ?? 0;
    const costSold = q * costPu;
    const realizedPl = m?.realizedPl ?? proceeds - costSold;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { totalQty: q, totalProceeds: proceeds, totalCostSold: costSold, totalRealizedPl: realizedPl });
    } else {
      prev.totalQty += q;
      prev.totalProceeds += proceeds;
      prev.totalCostSold += costSold;
      prev.totalRealizedPl += realizedPl;
    }
  });
  return Array.from(map.entries())
    .map(([key, v]) => {
      const [symbol, currency] = key.split('\0');
      const avgSell = v.totalQty > 0 ? v.totalProceeds / v.totalQty : 0;
      const avgCostPerUnit = v.totalQty > 0 ? v.totalCostSold / v.totalQty : 0;
      const realizedPct = v.totalCostSold > 1e-12 ? (v.totalRealizedPl / v.totalCostSold) * 100 : 0;
      return {
        symbol,
        currency,
        totalQty: v.totalQty,
        totalProceeds: v.totalProceeds,
        avgSell,
        avgCostPerUnit,
        totalRealizedPl: v.totalRealizedPl,
        realizedPct,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function sumCashByQuoteBucket(cashRows) {
  const m = new Map();
  for (const row of cashRows || []) {
    const ccy = String(row.currency || 'USD').trim().toUpperCase() || 'USD';
    const bucket = aggregateHypotheticalQuoteBucket(ccy);
    const v = Number(row.amountLocal);
    if (!Number.isFinite(v)) continue;
    m.set(bucket, (m.get(bucket) ?? 0) + v);
  }
  return m;
}

function sumHypotheticalBuyCostByQuoteBucket(buyRows) {
  const m = new Map();
  for (const row of buyRows || []) {
    const q = num(row.qty);
    if (!(q > 0)) continue;
    const quoteCcy = hypotheticalBuyQuoteCurrency(row);
    const bucket = aggregateHypotheticalQuoteBucket(quoteCcy);
    const cost = q * num(row.buyPrice);
    if (!Number.isFinite(cost)) continue;
    m.set(bucket, (m.get(bucket) ?? 0) + cost);
  }
  return m;
}

function sumHypotheticalSaleProceedsByQuoteBucket(sellRows) {
  const m = new Map();
  for (const row of sellRows || []) {
    const q = num(row.qty);
    if (!(q > 0)) continue;
    const quoteCcy =
      row?.assetClass === 'stock' ? 'USD' : String(row.currency || 'USD').trim().toUpperCase() || 'USD';
    const bucket = aggregateHypotheticalQuoteBucket(quoteCcy);
    const proceeds = Math.max(0, q * num(row.sellPrice));
    if (!Number.isFinite(proceeds)) continue;
    m.set(bucket, (m.get(bucket) ?? 0) + proceeds);
  }
  return m;
}

/**
 * Same sequencing as backend what-if: baseline book, apply hypothetical buys in list order,
 * then each hypothetical sale (avg cost before the sale, proportional cost removal).
 * Yields one entry per sell row for display (aligned with position sold-history columns).
 */
function hypotheticalSellRowMetricsSequence(portfolioTableRows, buyRows, sellRows) {
  const bySymbol = new Map();
  for (const row of portfolioTableRows || []) {
    const sym = String(row.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    bySymbol.set(sym, {
      qty: num(row.qty),
      costBasis: num(row.totalPurchaseCost),
      currency: String(row.currency || 'USD').trim().toUpperCase() || 'USD',
    });
  }

  function seedIfMissing(sym, sellRow) {
    if (bySymbol.has(sym)) return;
    const cur =
      sellRow?.assetClass === 'stock'
        ? 'USD'
        : String(sellRow?.currency || 'USD').trim().toUpperCase() || 'USD';
    bySymbol.set(sym, { qty: 0, costBasis: 0, currency: cur });
  }

  for (const buy of buyRows || []) {
    const sym = String(buy.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    const q = num(buy.qty);
    if (!(q > 0)) continue;
    if (!bySymbol.has(sym)) {
      const cur =
        buy.assetClass === 'stock'
          ? 'USD'
          : String(buy.currency || 'USD').trim().toUpperCase() || 'USD';
      bySymbol.set(sym, { qty: 0, costBasis: 0, currency: cur });
    }
    const st = bySymbol.get(sym);
    const addedCost = q * num(buy.buyPrice);
    st.qty += q;
    st.costBasis += addedCost;
    if (buy.assetClass === 'crypto' && buy.currency) {
      st.currency = String(buy.currency).trim().toUpperCase() || st.currency;
    }
  }

  const out = [];
  for (const sell of sellRows || []) {
    const sym = String(sell.symbol || '').trim().toUpperCase();
    seedIfMissing(sym, sell);
    const st = bySymbol.get(sym);
    const q = num(sell.qty);
    const sellPrice = num(sell.sellPrice);
    const proceeds = Math.max(0, q * sellPrice);

    let costPerUnit = 0;
    let realizedPl = 0;
    let realizedReturnPct = 0;

    if (st && st.qty > 1e-12) {
      costPerUnit = st.costBasis / st.qty;
      const costSold = q * costPerUnit;
      realizedPl = proceeds - costSold;
      realizedReturnPct = costSold <= 1e-12 ? 0 : (realizedPl / costSold) * 100;
      const removedCost = (st.costBasis * q) / st.qty;
      st.qty -= q;
      st.costBasis = Math.max(0, st.costBasis - removedCost);
    } else {
      costPerUnit = 0;
      realizedPl = proceeds;
      realizedReturnPct = 0;
    }

    out.push({ costPerUnit, proceeds, realizedPl, realizedReturnPct });
  }
  return out;
}

function emptyStockSellForm() {
  return { selectedSymbol: '', qty: '', sellPrice: '', sellPct: 0 };
}

function emptyCryptoSellForm() {
  return { selectedSymbol: '', qty: '', sellPrice: '', sellPct: 0 };
}

function mapApiHypotheticalPurchasesToBuyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    id: row.id || `saved-${index}`,
    assetClass: inferAssetClass(row),
    symbol: String(row.symbol || '').toUpperCase(),
    qty: row.qty,
    buyPrice: row.buyPrice,
    currency: String(row.currency || '').toUpperCase() || null,
    ...(row.productId ? { productId: String(row.productId) } : {}),
  }));
}

function mapApiHypotheticalSalesToSellRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    id: row.id || `sale-saved-${index}`,
    assetClass: inferAssetClass({ currency: row.currency }),
    symbol: String(row.symbol || '').toUpperCase(),
    qty: row.qty,
    sellPrice: row.sellPrice,
    currency: String(row.currency || '').toUpperCase() || null,
  }));
}

function normalizeHypoBuyCsvHeaderCell(cell) {
  return String(cell || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function mapHypoBuyCsvHeaderToKey(normalized) {
  const map = {
    assetclass: 'assetClass',
    type: 'assetClass',
    asset_type: 'assetClass',
    class: 'assetClass',
    symbol: 'symbol',
    ticker: 'symbol',
    qty: 'qty',
    quantity: 'qty',
    buyprice: 'buyPrice',
    buy_price: 'buyPrice',
    price: 'buyPrice',
    avg_cost: 'buyPrice',
    avgcost: 'buyPrice',
    cost_per_unit: 'buyPrice',
    currency: 'currency',
    ccy: 'currency',
    quote: 'currency',
  };
  return map[normalized] || null;
}

function parseHypoBuyCsvQuotedLine(line) {
  const result = [];
  let i = 0;
  let field = '';
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else if (c === ',') {
      result.push(field.trim());
      field = '';
      i++;
    } else if (c === '"') {
      inQuotes = true;
      i++;
    } else {
      field += c;
      i++;
    }
  }
  result.push(field.trim());
  return result;
}

function splitHypoBuyCsvLine(line, delimiter) {
  if (delimiter === '\t') {
    return line.split('\t').map((c) => c.trim());
  }
  return parseHypoBuyCsvQuotedLine(line);
}

function detectHypoBuyCsvDelimiter(line) {
  const hasTab = line.includes('\t');
  const hasComma = line.includes(',');
  if (hasTab && !hasComma) return '\t';
  return ',';
}

function normalizeHypoBuyCsvAssetClass(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (['stock', 'stocks', 'equity', 's'].includes(s)) return 'stock';
  if (['crypto', 'c', 'coin'].includes(s)) return 'crypto';
  return '';
}

/**
 * Parses simulated-buy bulk CSV/TSV. Header row required: assetClass, symbol, qty, buyPrice; currency optional.
 * @returns {{ ok: true, rows: Array<{ assetClass: string, symbol: string, qty: number, buyPrice: number, currency: string }> } | { ok: false, messageKey: string, vars: Record<string, string|number> }}
 */
function parseHypotheticalBuyCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { ok: false, messageKey: 'whatif.hypoBuyCsvErrNeedRows', vars: {} };
  }
  const delim = detectHypoBuyCsvDelimiter(lines[0]);
  const headerCells = splitHypoBuyCsvLine(lines[0], delim).map(normalizeHypoBuyCsvHeaderCell);
  const col = {};
  for (let i = 0; i < headerCells.length; i++) {
    const key = mapHypoBuyCsvHeaderToKey(headerCells[i]);
    if (key) col[key] = i;
  }
  const required = ['assetClass', 'symbol', 'qty', 'buyPrice'];
  for (const req of required) {
    if (col[req] == null) {
      return { ok: false, messageKey: 'whatif.hypoBuyCsvErrMissingHeader', vars: { field: req } };
    }
  }
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const lineNo = li + 1;
    const cells = splitHypoBuyCsvLine(lines[li], delim);
    const assetClass = normalizeHypoBuyCsvAssetClass(cells[col.assetClass] ?? '');
    const symbol = normalizeText(cells[col.symbol] ?? '').toUpperCase();
    const qty = num(cells[col.qty]);
    const buyPrice = num(cells[col.buyPrice]);
    let currency = col.currency != null ? String(cells[col.currency] ?? '').trim() : '';
    currency = currency.toUpperCase() || 'USD';

    if (!assetClass) {
      return { ok: false, messageKey: 'whatif.hypoBuyCsvErrBadAssetClass', vars: { line: lineNo } };
    }
    if (!symbol) {
      return { ok: false, messageKey: 'whatif.hypoBuyCsvErrBadSymbol', vars: { line: lineNo } };
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, messageKey: 'whatif.hypoBuyCsvErrBadQty', vars: { line: lineNo } };
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      return { ok: false, messageKey: 'whatif.hypoBuyCsvErrBadPrice', vars: { line: lineNo } };
    }
    if (assetClass === 'stock') {
      currency = 'USD';
    }
    rows.push({ assetClass, symbol, qty, buyPrice, currency });
  }
  if (rows.length === 0) {
    return { ok: false, messageKey: 'whatif.hypoBuyCsvErrNoValidRows', vars: {} };
  }
  return { ok: true, rows };
}

/** Hover overlay for weight chart bars — matches portfolio / profitability bar charts (stroke + glow). */
function ActiveWhatIfWeightBar(props) {
  const { x, y, width, height, fill } = props;
  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      radius={[4, 4, 0, 0]}
      fill={fill}
      stroke="#67e8f9"
      strokeWidth={2}
      style={{ filter: 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.45))' }}
    />
  );
}

export default function WhatIfScenariosPage({ hideValues }) {
  const { t } = useLanguage();
  const { netWorth, baseCurrency, portfolio } = useDashboard();
  const [scenarios, setScenarios] = useState([]);
  const [activeScenarioId, setActiveScenarioId] = useState('');
  const [newScenarioName, setNewScenarioName] = useState('');
  const [isAddingScenario, setIsAddingScenario] = useState(false);
  const [isDuplicatingScenario, setIsDuplicatingScenario] = useState(false);
  const [duplicateScenarioName, setDuplicateScenarioName] = useState('');
  const [isRenamingScenario, setIsRenamingScenario] = useState(false);
  const [renameScenarioName, setRenameScenarioName] = useState('');
  const [expandedHypoBuyKeys, setExpandedHypoBuyKeys] = useState(() => new Set());
  const [expandedHypoSellKeys, setExpandedHypoSellKeys] = useState(() => new Set());
  const [targetPrices, setTargetPrices] = useState([]);
  /** Last target rows accepted by the server; hypothetical saves use this so in-flight target edits are not persisted until blur/debounced save. */
  const [lastSyncedTargetPrices, setLastSyncedTargetPrices] = useState([]);
  const [targetPricePctBySymbol, setTargetPricePctBySymbol] = useState({});
  const [targetPrice2PctBySymbol, setTargetPrice2PctBySymbol] = useState({});
  const [buyRows, setBuyRows] = useState([]);
  const [sellRows, setSellRows] = useState([]);
  const [adjustScenarioCashForHypotheticals, setAdjustScenarioCashForHypotheticals] = useState(true);
  const [stockForm, setStockForm] = useState(emptyStockForm());
  const [cryptoForm, setCryptoForm] = useState(emptyCryptoForm());
  const [hypoBuyCsvText, setHypoBuyCsvText] = useState('');
  const [hypoBuyAddMenuOpen, setHypoBuyAddMenuOpen] = useState(false);
  const [hypoBuyStockModalOpen, setHypoBuyStockModalOpen] = useState(false);
  const [hypoBuyCryptoModalOpen, setHypoBuyCryptoModalOpen] = useState(false);
  const [hypoBuyCsvModalOpen, setHypoBuyCsvModalOpen] = useState(false);
  const hypoBuyMenuWrapRef = useRef(null);
  const [hypoSellAddMenuOpen, setHypoSellAddMenuOpen] = useState(false);
  const [hypoSellStockModalOpen, setHypoSellStockModalOpen] = useState(false);
  const [hypoSellCryptoModalOpen, setHypoSellCryptoModalOpen] = useState(false);
  const hypoSellMenuWrapRef = useRef(null);
  const [stockSellForm, setStockSellForm] = useState(emptyStockSellForm());
  const [cryptoSellForm, setCryptoSellForm] = useState(emptyCryptoSellForm());
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScenarioLoading, setIsScenarioLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPersistingInputs, setIsPersistingInputs] = useState(false);
  const [error, setError] = useState('');
  const blockInputPersistRef = useRef(false);
  /** Bumps when starting a scenario load so stale in-flight GET /results cannot apply wrong buys/sales. */
  const whatIfLoadSeqRef = useRef(0);
  /** Serializes PUT /inputs so overlapping saves cannot race server-side (e.g. target price unique index). */
  const persistQueueTailRef = useRef(Promise.resolve());
  const persistSeqRef = useRef(0);
  const activeScenarioIdRef = useRef('');
  const targetPricesRef = useRef([]);
  const lastSyncedTargetPricesRef = useRef([]);
  const buyRowsRef = useRef([]);
  const sellRowsRef = useRef([]);
  const [lastSavedHash, setLastSavedHash] = useState(EMPTY_WHATIF_INPUTS_HASH);
  const stockHypotheticalQtyRef = useRef(null);
  const cryptoHypotheticalQtyRef = useRef(null);
  const stockSellQtyRef = useRef(null);
  const cryptoSellQtyRef = useRef(null);

  activeScenarioIdRef.current = activeScenarioId;
  targetPricesRef.current = targetPrices;
  lastSyncedTargetPricesRef.current = lastSyncedTargetPrices;
  buyRowsRef.current = buyRows;
  sellRowsRef.current = sellRows;

  function resetScenarioEditorState() {
    setTargetPrices([]);
    setTargetPricePctBySymbol({});
    setTargetPrice2PctBySymbol({});
    setBuyRows([]);
    setSellRows([]);
    setLastSyncedTargetPrices([]);
    setLastSavedHash(EMPTY_WHATIF_INPUTS_HASH);
    setStockForm(emptyStockForm());
    setCryptoForm(emptyCryptoForm());
    setHypoBuyCsvText('');
    setHypoBuyAddMenuOpen(false);
    setHypoBuyStockModalOpen(false);
    setHypoBuyCryptoModalOpen(false);
    setHypoBuyCsvModalOpen(false);
    setHypoSellAddMenuOpen(false);
    setHypoSellStockModalOpen(false);
    setHypoSellCryptoModalOpen(false);
    setStockSellForm(emptyStockSellForm());
    setCryptoSellForm(emptyCryptoSellForm());
    setResults(null);
  }

  function computeInputsHash(nextTargetPrices, nextBuyRows, nextSellRows = []) {
    const targetRows = (nextTargetPrices || [])
      .map((row) => ({
        symbol: String(row?.symbol || '').trim().toUpperCase(),
        targetPrice: num(row?.targetPrice),
        targetPrice2: num(row?.targetPrice2),
        currency: String(row?.currency || '').trim().toUpperCase() || null,
      }))
      .filter((row) => row.symbol && (row.targetPrice > 0 || row.targetPrice2 > 0))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    const purchaseRows = (nextBuyRows || [])
      .map((row) => ({
        symbol: String(row?.symbol || '').trim().toUpperCase(),
        qty: num(row?.qty),
        buyPrice: num(row?.buyPrice),
        currency:
          row?.assetClass === 'stock'
            ? 'USD'
            : String(row?.currency || '').trim().toUpperCase() || 'USD',
      }))
      .filter((row) => row.symbol && row.qty > 0 && row.buyPrice >= 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    const saleRows = (nextSellRows || [])
      .map((row) => ({
        symbol: String(row?.symbol || '').trim().toUpperCase(),
        qty: num(row?.qty),
        sellPrice: num(row?.sellPrice),
        feeFlat: null,
        currency:
          row?.assetClass === 'stock'
            ? 'USD'
            : String(row?.currency || '').trim().toUpperCase() || 'USD',
      }))
      .filter((row) => row.symbol && row.qty > 0 && row.sellPrice >= 0);

    return JSON.stringify({ targetRows, purchaseRows, saleRows });
  }

  const portfolioTableRows = Array.isArray(portfolio?.tableRows) ? portfolio.tableRows : [];
  const stockHoldingsForSell = useMemo(
    () => portfolioTableRows.filter((row) => holdingAssetClass(row) === 'stock' && num(row.qty) > 0),
    [portfolioTableRows],
  );
  const cryptoHoldingsForSell = useMemo(
    () => portfolioTableRows.filter((row) => holdingAssetClass(row) === 'crypto' && num(row.qty) > 0),
    [portfolioTableRows],
  );

  const stockSellHoldingsOptions = useMemo(
    () =>
      [...stockHoldingsForSell].sort((a, b) =>
        String(a.symbol || '').localeCompare(String(b.symbol || '')),
      ),
    [stockHoldingsForSell],
  );

  const cryptoSellHoldingsOptions = useMemo(
    () =>
      [...cryptoHoldingsForSell].sort((a, b) =>
        String(a.symbol || '').localeCompare(String(b.symbol || '')),
      ),
    [cryptoHoldingsForSell],
  );

  function maxSellableQtyForSymbol(symbol, excludeRowId = null) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return 0;
    const baselineRow = portfolioTableRows.find((r) => String(r.symbol || '').trim().toUpperCase() === sym);
    let baseQty = num(baselineRow?.qty);
    let fromBuys = 0;
    for (const r of buyRows) {
      if (String(r.symbol || '').trim().toUpperCase() !== sym) continue;
      fromBuys += num(r.qty);
    }
    let fromSells = 0;
    for (const r of sellRows) {
      if (excludeRowId != null && r.id === excludeRowId) continue;
      if (String(r.symbol || '').trim().toUpperCase() !== sym) continue;
      fromSells += num(r.qty);
    }
    return Math.max(0, baseQty + fromBuys - fromSells);
  }

  /** Sum of hypothetical sell quantities already entered for this symbol (optionally excluding one row). */
  function hypotheticalSellQtyCommittedForSymbol(symbol, excludeRowId = null) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return 0;
    let sum = 0;
    for (const r of sellRows) {
      if (excludeRowId != null && r.id === excludeRowId) continue;
      if (String(r.symbol || '').trim().toUpperCase() !== sym) continue;
      sum += num(r.qty);
    }
    return sum;
  }

  /** Live dashboard qty only (excludes hypothetical buys)—for sell UI copy. */
  function livePortfolioQtyForSymbol(symbol) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return 0;
    const baselineRow = portfolioTableRows.find((r) => String(r.symbol || '').trim().toUpperCase() === sym);
    return Math.max(0, num(baselineRow?.qty));
  }

  function hypotheticalBuyQtyForSymbol(symbol) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return 0;
    let sum = 0;
    for (const r of buyRows) {
      if (String(r.symbol || '').trim().toUpperCase() !== sym) continue;
      sum += num(r.qty);
    }
    return sum;
  }

  /**
   * Max qty for sell form inputs: remaining scenario position (baseline + hypo buys − hypo sells).
   */
  function sellFormAvailableQtyForSymbol(symbol, excludeRowId = null) {
    const scenario = maxSellableQtyForSymbol(symbol, excludeRowId);
    return scenario;
  }

  function handleStockSellPctChange(e) {
    const pct = Number(e.target.value);
    const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    setStockSellForm((prev) => {
      const sym = normalizeText(prev.selectedSymbol).toUpperCase();
      const availableQty = sellFormAvailableQtyForSymbol(sym);
      if (!(availableQty > 0)) return { ...prev, sellPct: safePct, qty: '' };
      const nextQty =
        safePct >= 100 - 1e-9 ? availableQty : roundDownSellQty((availableQty * safePct) / 100, 8);
      return { ...prev, sellPct: safePct, qty: nextQty > 0 ? String(nextQty) : '' };
    });
  }

  function handleStockSellQtyChange(e) {
    const nextRaw = sanitizeDecimalInput(e.target.value, { allowNegative: false });
    setStockSellForm((prev) => {
      const sym = normalizeText(prev.selectedSymbol).toUpperCase();
      const availableQty = sellFormAvailableQtyForSymbol(sym);
      if (!(availableQty > 0)) return { ...prev, qty: nextRaw, sellPct: 0 };
      const qtyNum = Number(nextRaw);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return { ...prev, qty: nextRaw, sellPct: 0 };
      }
      const clamped = Math.min(qtyNum, availableQty);
      let qtyStr = nextRaw;
      if (qtyNum > availableQty + 1e-12) qtyStr = String(availableQty);
      const pctDerived = availableQty > 0 ? (clamped / availableQty) * 100 : 0;
      return {
        ...prev,
        qty: qtyStr,
        sellPct: Number(Math.max(0, Math.min(100, pctDerived)).toFixed(1)),
      };
    });
  }

  function handleCryptoSellPctChange(e) {
    const pct = Number(e.target.value);
    const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    setCryptoSellForm((prev) => {
      const sym = normalizeText(prev.selectedSymbol).toUpperCase();
      const availableQty = sellFormAvailableQtyForSymbol(sym);
      if (!(availableQty > 0)) return { ...prev, sellPct: safePct, qty: '' };
      const nextQty =
        safePct >= 100 - 1e-9 ? availableQty : roundDownSellQty((availableQty * safePct) / 100, 8);
      return { ...prev, sellPct: safePct, qty: nextQty > 0 ? String(nextQty) : '' };
    });
  }

  function handleCryptoSellQtyChange(e) {
    const nextRaw = sanitizeDecimalInput(e.target.value, { allowNegative: false });
    setCryptoSellForm((prev) => {
      const sym = normalizeText(prev.selectedSymbol).toUpperCase();
      const availableQty = sellFormAvailableQtyForSymbol(sym);
      if (!(availableQty > 0)) return { ...prev, qty: nextRaw, sellPct: 0 };
      const qtyNum = Number(nextRaw);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return { ...prev, qty: nextRaw, sellPct: 0 };
      }
      const clamped = Math.min(qtyNum, availableQty);
      let qtyStr = nextRaw;
      if (qtyNum > availableQty + 1e-12) qtyStr = String(availableQty);
      const pctDerived = availableQty > 0 ? (clamped / availableQty) * 100 : 0;
      return {
        ...prev,
        qty: qtyStr,
        sellPct: Number(Math.max(0, Math.min(100, pctDerived)).toFixed(1)),
      };
    });
  }

  function confirmDiscardIfDirty(isDirty) {
    if (!isDirty) return true;
    return window.confirm('You have unsaved changes. Continue without saving?');
  }

  const fetchStockSymbols = useCallback(async (q) => {
    const res = await fetchJson('/api/market/us-stock-symbols', {
      params: new URLSearchParams({ q, limit: '50' }),
    });
    return Array.isArray(res?.symbols) ? res.symbols : [];
  }, []);

  const fetchCryptoProducts = useCallback(async (q) => {
    const res = await fetchJson('/api/market/coinbase-products', {
      params: new URLSearchParams({ q, limit: '100' }),
    });
    return Array.isArray(res?.products) ? res.products : [];
  }, []);

  const { items: stockSymbols, isLoading: isLoadingStockSymbols } = useDebouncedSearch(
    stockForm.query,
    Boolean(activeScenarioId),
    fetchStockSymbols,
    250,
    setError,
    t('errors.failedLoadSymbols'),
  );
  const stockSymbolsSorted = useMemo(() => {
    const q = normalizeText(stockForm.query).toUpperCase();
    if (!q || stockSymbols.length === 0) return stockSymbols;
    const exact = stockSymbols.find((s) => String(s.symbol || '').toUpperCase() === q);
    if (!exact) return stockSymbols;
    return [exact, ...stockSymbols.filter((s) => String(s.symbol || '').toUpperCase() !== q)];
  }, [stockSymbols, stockForm.query]);
  const { items: cryptoProducts, isLoading: isLoadingCryptoProducts } = useDebouncedSearch(
    cryptoForm.query,
    Boolean(activeScenarioId),
    fetchCryptoProducts,
    250,
    setError,
    t('errors.failedLoadProducts'),
  );

  async function loadScenarios() {
    const data = await fetchJson('/api/whatif/scenarios');
    const rows = Array.isArray(data?.scenarios) ? data.scenarios : [];
    setScenarios(rows);
    const activeId = data?.activeScenarioId || rows[0]?.id || '';
    setActiveScenarioId(activeId);
    return activeId;
  }

  async function loadScenarioPayload(scenarioId) {
    blockInputPersistRef.current = true;
    setIsScenarioLoading(true);
    if (!scenarioId) {
      whatIfLoadSeqRef.current += 1;
      setTargetPrices([]);
      setLastSyncedTargetPrices([]);
      setTargetPricePctBySymbol({});
      setTargetPrice2PctBySymbol({});
      setBuyRows([]);
      setSellRows([]);
      setStockForm(emptyStockForm());
      setCryptoForm(emptyCryptoForm());
      setStockSellForm(emptyStockSellForm());
      setCryptoSellForm(emptyCryptoSellForm());
      setResults(null);
      setLastSavedHash(EMPTY_WHATIF_INPUTS_HASH);
      setIsScenarioLoading(false);
      blockInputPersistRef.current = false;
      return;
    }
    const loadSeq = ++whatIfLoadSeqRef.current;
    try {
      const resultRes = await fetchJson(`/api/whatif/scenarios/${scenarioId}/results`);
      if (loadSeq !== whatIfLoadSeqRef.current) return;
      const resultRows = Array.isArray(resultRes?.rows) ? resultRes.rows : [];
      const savedTargets = Array.isArray(resultRes?.targetPrices) ? resultRes.targetPrices : [];
      const savedBySymbol = new Map(savedTargets.map((row) => [String(row.symbol || '').toUpperCase(), row]));
      const prefilledTargets = resultRows.map((row) => {
        const symbol = String(row.symbol || '').toUpperCase();
        const saved = savedBySymbol.get(symbol);
        if (saved) {
          const tp2Saved = num(saved.targetPrice2);
          return {
            symbol,
            targetPrice: saved.targetPrice,
            targetPrice2: tp2Saved > 0 ? saved.targetPrice2 : '',
            currency: saved.currency || row.currency || 'USD',
          };
        }
        return {
          symbol,
          targetPrice: num(row.baselinePrice) > 0 ? row.baselinePrice : '',
          targetPrice2: '',
          currency: row.currency || 'USD',
        };
      });
      const pctBySymbol = {};
      const pct2BySymbol = {};
      for (const row of resultRows) {
        const symbol = String(row.symbol || '').toUpperCase();
        const baseline = num(row.baselinePrice);
        const saved = savedBySymbol.get(symbol);
        const pref = prefilledTargets.find((x) => String(x.symbol).toUpperCase() === symbol);
        const target = pref?.targetPrice;
        const targetNum = num(target);
        // Keep % input empty by default; only prefill when a saved target price exists.
        pctBySymbol[symbol] =
          saved && baseline > 0 && target !== ''
            ? (((targetNum - baseline) / baseline) * 100).toFixed(2)
            : '';
        const t2 = pref?.targetPrice2;
        const t2Num = num(t2);
        pct2BySymbol[symbol] =
          saved && baseline > 0 && num(saved?.targetPrice2) > 0 && t2 !== ''
            ? (((t2Num - baseline) / baseline) * 100).toFixed(2)
            : '';
      }
      setTargetPrices(prefilledTargets);
      setLastSyncedTargetPrices(cloneSyncedTargetRows(prefilledTargets));
      setTargetPricePctBySymbol(pctBySymbol);
      setTargetPrice2PctBySymbol(pct2BySymbol);
      const mappedBuys = mapApiHypotheticalPurchasesToBuyRows(resultRes?.hypotheticalPurchases);
      setBuyRows(mappedBuys);
      const mappedSales = mapApiHypotheticalSalesToSellRows(resultRes?.hypotheticalSales);
      setSellRows(mappedSales);
      setStockForm(emptyStockForm());
      setCryptoForm(emptyCryptoForm());
      setStockSellForm(emptyStockSellForm());
      setCryptoSellForm(emptyCryptoSellForm());
      setResults(resultRes);
      setLastSavedHash(computeInputsHash(prefilledTargets, mappedBuys, mappedSales));
    } finally {
      setIsScenarioLoading(false);
      blockInputPersistRef.current = false;
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setIsLoading(true);
        setError('');
        const activeId = await loadScenarios();
        if (!mounted) return;
        await loadScenarioPayload(activeId);
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || t('errors.failedLoadData'));
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [t]);

  async function refreshCurrentScenario(scenarioId = activeScenarioId) {
    await loadScenarioPayload(scenarioId);
  }

  /** Names are unique per user (case-insensitive). Skip `excludeScenarioId` when renaming the same scenario. */
  function scenarioNameIsTaken(trimmedName, excludeScenarioId = null) {
    const lower = String(trimmedName || '').trim().toLowerCase();
    if (!lower) return false;
    return scenarios.some((s) => {
      if (excludeScenarioId != null && s.id === excludeScenarioId) return false;
      return String(s.name || '').trim().toLowerCase() === lower;
    });
  }

  async function handleCreateScenario() {
    const name = String(newScenarioName || '').trim();
    if (!name) return;
    if (name.length > 120) {
      setError(t('whatif.scenarioNameTooLong'));
      return;
    }
    if (scenarioNameIsTaken(name)) {
      setError(t('whatif.scenarioNameAlreadyExists'));
      return;
    }
    try {
      setIsSaving(true);
      setError('');
      if (!confirmDiscardIfDirty(isDirty)) return;
      const created = await postJson('/api/whatif/scenarios', { name, makeActive: true });
      const id = created?.scenario?.id;
      setNewScenarioName('');
      setIsAddingScenario(false);
      resetScenarioEditorState();
      await loadScenarios();
      if (id) {
        setActiveScenarioId(id);
        await refreshCurrentScenario(id);
      }
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  function openDuplicateScenario() {
    if (!activeScenarioId) return;
    const src = scenarios.find((s) => s.id === activeScenarioId);
    const base = src?.name != null ? String(src.name) : '';
    setDuplicateScenarioName(base ? `${t('whatif.duplicateNamePrefix')} ${base}` : '');
    setIsAddingScenario(false);
    setIsRenamingScenario(false);
    setRenameScenarioName('');
    setIsDuplicatingScenario(true);
    setError('');
  }

  function openRenameScenario() {
    if (!activeScenarioId) return;
    const src = scenarios.find((s) => s.id === activeScenarioId);
    setRenameScenarioName(src?.name != null ? String(src.name) : '');
    setIsAddingScenario(false);
    setIsDuplicatingScenario(false);
    setDuplicateScenarioName('');
    setIsRenamingScenario(true);
    setError('');
  }

  async function handleRenameScenario() {
    if (!activeScenarioId) return;
    const name = String(renameScenarioName || '').trim();
    if (!name) return;
    const current = scenarios.find((s) => s.id === activeScenarioId);
    const currentName = current?.name != null ? String(current.name).trim() : '';
    if (name === currentName) {
      setIsRenamingScenario(false);
      setRenameScenarioName('');
      return;
    }
    if (name.length > 120) {
      setError(t('whatif.scenarioNameTooLong'));
      return;
    }
    if (scenarioNameIsTaken(name, activeScenarioId)) {
      setError(t('whatif.scenarioNameAlreadyExists'));
      return;
    }
    try {
      setIsSaving(true);
      setError('');
      await putJson(`/api/whatif/scenarios/${activeScenarioId}`, { name });
      setRenameScenarioName('');
      setIsRenamingScenario(false);
      await loadScenarios();
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDuplicateScenario() {
    if (!activeScenarioId) return;
    const name = String(duplicateScenarioName || '').trim();
    if (!name) return;
    if (name.length > 120) {
      setError(t('whatif.scenarioNameTooLong'));
      return;
    }
    if (scenarioNameIsTaken(name)) {
      setError(t('whatif.scenarioNameAlreadyExists'));
      return;
    }
    try {
      setIsSaving(true);
      setError('');
      if (!confirmDiscardIfDirty(isDirty)) return;
      const created = await postJson(`/api/whatif/scenarios/${activeScenarioId}/duplicate`, {
        name,
        makeActive: true,
      });
      const id = created?.scenario?.id;
      setDuplicateScenarioName('');
      setIsDuplicatingScenario(false);
      resetScenarioEditorState();
      await loadScenarios();
      if (id) {
        setActiveScenarioId(id);
        await refreshCurrentScenario(id);
      }
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivateScenario(nextId) {
    if (!nextId) return;
    try {
      setIsSaving(true);
      setError('');
      if (!confirmDiscardIfDirty(isDirty)) return;
      resetScenarioEditorState();
      await postJson(`/api/whatif/scenarios/${nextId}/activate`, {});
      setActiveScenarioId(nextId);
      await loadScenarios();
      await refreshCurrentScenario(nextId);
    } catch (err) {
      setError(err?.message || t('errors.failedUpdate'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteScenario() {
    if (!activeScenarioId) return;
    try {
      setIsSaving(true);
      setError('');
      if (!confirmDiscardIfDirty(isDirty)) return;
      await deleteJson(`/api/whatif/scenarios/${activeScenarioId}`);
      const nextId = await loadScenarios();
      await refreshCurrentScenario(nextId);
    } catch (err) {
      setError(err?.message || t('errors.failedDelete'));
    } finally {
      setIsSaving(false);
    }
  }

  function updateTargetPrice(symbol, value, currency) {
    const sym = String(symbol || '').trim().toUpperCase();
    const nextNum = coerceTargetPriceInputValue(value);
    setTargetPrices((prev) => {
      const existing = prev.find((row) => String(row.symbol).toUpperCase() === sym);
      if (!existing)
        return [...prev, { symbol: sym, targetPrice: nextNum, targetPrice2: '', currency: currency || '' }];
      return prev.map((row) =>
        String(row.symbol).toUpperCase() === sym
          ? { ...row, targetPrice: nextNum, currency: currency || row.currency }
          : row,
      );
    });
  }

  function updateTargetPrice2(symbol, value, currency) {
    const sym = String(symbol || '').trim().toUpperCase();
    const nextNum = coerceTargetPriceInputValue(value);
    setTargetPrices((prev) => {
      const existing = prev.find((row) => String(row.symbol).toUpperCase() === sym);
      if (!existing)
        return [...prev, { symbol: sym, targetPrice: '', targetPrice2: nextNum, currency: currency || '' }];
      return prev.map((row) =>
        String(row.symbol).toUpperCase() === sym
          ? { ...row, targetPrice2: nextNum, currency: currency || row.currency }
          : row,
      );
    });
  }

  function updateTargetPricePct(symbol, value, baselinePrice, currency) {
    const sym = String(symbol || '').trim().toUpperCase();
    const baseline = num(baselinePrice);
    setTargetPricePctBySymbol((prev) => ({ ...prev, [sym]: value }));
    if (!baseline || value === '' || value === '-' || value === '.' || value === '-.') {
      return;
    }
    const pct = Number(value);
    if (!Number.isFinite(pct)) return;
    const target = baseline * (1 + pct / 100);
    updateTargetPrice(sym, target, currency);
  }

  function updateTargetPrice2Pct(symbol, value, baselinePrice, currency) {
    const sym = String(symbol || '').trim().toUpperCase();
    const baseline = num(baselinePrice);
    setTargetPrice2PctBySymbol((prev) => ({ ...prev, [sym]: value }));
    if (!baseline || value === '' || value === '-' || value === '.' || value === '-.') {
      return;
    }
    const pct = Number(value);
    if (!Number.isFinite(pct)) return;
    const target = baseline * (1 + pct / 100);
    updateTargetPrice2(sym, target, currency);
  }

  const persistScenarioInputs = useCallback(async (scenarioId, nextTargetPrices, nextBuyRows, nextSellRows = []) => {
    const execute = async () => {
      if (!scenarioId) return false;
      const dedupedTargetRows = new Map();
      for (const row of nextTargetPrices || []) {
        const symbol = String(row?.symbol || '').trim().toUpperCase();
        const targetPrice = num(row?.targetPrice);
        const targetPrice2 = num(row?.targetPrice2);
        const currency = String(row?.currency || '').trim().toUpperCase() || null;
        if (!symbol || (targetPrice <= 0 && targetPrice2 <= 0)) continue;
        // Last writer wins for duplicate symbols, preventing unique-key failures server-side.
        dedupedTargetRows.set(symbol, {
          symbol,
          targetPrice: targetPrice > 0 ? targetPrice : 0,
          targetPrice2: targetPrice2 > 0 ? targetPrice2 : 0,
          currency,
        });
      }
      const targetRows = Array.from(dedupedTargetRows.values());
      const purchaseRows = nextBuyRows
        .map((row) => ({
          symbol: String(row.symbol || '').trim().toUpperCase(),
          qty: num(row.qty),
          buyPrice: num(row.buyPrice),
          currency: row.assetClass === 'stock' ? 'USD' : String(row.currency || '').trim().toUpperCase() || 'USD',
        }))
        .filter((row) => row.symbol && row.qty > 0 && row.buyPrice >= 0);

      const saleRows = (nextSellRows || [])
        .map((row) => ({
          symbol: String(row.symbol || '').trim().toUpperCase(),
          qty: num(row.qty),
          sellPrice: num(row.sellPrice),
          feeFlat: null,
          currency: row.assetClass === 'stock' ? 'USD' : String(row.currency || '').trim().toUpperCase() || 'USD',
        }))
        .filter((row) => row.symbol && row.qty > 0 && row.sellPrice >= 0);

      const seq = ++persistSeqRef.current;
      setIsPersistingInputs(true);
      setError('');
      try {
        const nextResults = await putJson(`/api/whatif/scenarios/${scenarioId}/inputs`, {
          targetPrices: targetRows,
          hypotheticalPurchases: purchaseRows,
          hypotheticalSales: saleRows,
        });
        if (seq !== persistSeqRef.current || scenarioId !== activeScenarioIdRef.current) {
          return false;
        }
        setResults(nextResults);
        const syncedBuys = mapApiHypotheticalPurchasesToBuyRows(nextResults?.hypotheticalPurchases);
        const syncedSales = mapApiHypotheticalSalesToSellRows(nextResults?.hypotheticalSales);
        setBuyRows(syncedBuys);
        setSellRows(syncedSales);
        return computeInputsHash(nextTargetPrices, syncedBuys, syncedSales);
      } catch (err) {
        if (seq === persistSeqRef.current && scenarioId === activeScenarioIdRef.current) {
          throw err;
        }
        return false;
      } finally {
        if (seq === persistSeqRef.current) {
          setIsPersistingInputs(false);
        }
      }
    };

    const chained = persistQueueTailRef.current.catch(() => {}).then(execute);
    persistQueueTailRef.current = chained.catch(() => {});
    return chained;
  }, []);

  const currentInputsHash = useMemo(
    () => computeInputsHash(targetPrices, buyRows, sellRows),
    [buyRows, sellRows, targetPrices],
  );
  const aggregatedHypotheticalBuys = useMemo(() => aggregateHypotheticalBuyRows(buyRows), [buyRows]);

  useEffect(() => {
    const valid = new Set(aggregatedHypotheticalBuys.map((r) => `${r.symbol}\0${r.currency}`));
    setExpandedHypoBuyKeys((prev) => {
      let changed = false;
      const next = new Set();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [aggregatedHypotheticalBuys]);

  const hypotheticalAggregateCostSubtotals = useMemo(() => {
    const m = new Map();
    for (const row of aggregatedHypotheticalBuys) {
      const c = String(row.currency || 'USD').trim().toUpperCase() || 'USD';
      m.set(c, (m.get(c) ?? 0) + num(row.totalCost));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [aggregatedHypotheticalBuys]);
  const hypotheticalSellMetricsByIndex = useMemo(
    () => hypotheticalSellRowMetricsSequence(portfolioTableRows, buyRows, sellRows),
    [portfolioTableRows, buyRows, sellRows],
  );
  const aggregatedHypotheticalSellSummary = useMemo(
    () => buildAggregatedHypotheticalSellSummary(sellRows, hypotheticalSellMetricsByIndex),
    [sellRows, hypotheticalSellMetricsByIndex],
  );
  const hypotheticalSellSubtotalsByCurrency = useMemo(() => {
    const m = new Map();
    (sellRows || []).forEach((row, index) => {
      const quoteCcy =
        row?.assetClass === 'stock' ? 'USD' : String(row?.currency || 'USD').trim().toUpperCase() || 'USD';
      const bucket = aggregateHypotheticalQuoteBucket(quoteCcy);
      const met = hypotheticalSellMetricsByIndex[index];
      const q = num(row.qty);
      if (!(q > 0)) return;
      const proceeds = met?.proceeds ?? Math.max(0, q * num(row.sellPrice));
      const costPu = met?.costPerUnit ?? 0;
      const costSold = q * costPu;
      const rp = met?.realizedPl ?? proceeds - costSold;
      const prev = m.get(bucket) ?? { totalQty: 0, totalProceeds: 0, totalRealizedPl: 0, totalCostSold: 0 };
      prev.totalQty += q;
      prev.totalProceeds += proceeds;
      prev.totalRealizedPl += rp;
      prev.totalCostSold += costSold;
      m.set(bucket, prev);
    });
    return Array.from(m.entries())
      .map(([currency, v]) => ({
        currency,
        totalQty: v.totalQty,
        totalProceeds: v.totalProceeds,
        totalRealizedPl: v.totalRealizedPl,
        totalCostSold: v.totalCostSold,
        avgSell: v.totalQty > 0 ? v.totalProceeds / v.totalQty : 0,
        avgCostPerUnit: v.totalQty > 0 ? v.totalCostSold / v.totalQty : 0,
        realizedPct: v.totalCostSold > 1e-12 ? (v.totalRealizedPl / v.totalCostSold) * 100 : 0,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [sellRows, hypotheticalSellMetricsByIndex]);

  useEffect(() => {
    const valid = new Set(
      aggregatedHypotheticalSellSummary.map((r) => `${r.symbol}\0${r.currency}`),
    );
    setExpandedHypoSellKeys((prev) => {
      let changed = false;
      const next = new Set();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [aggregatedHypotheticalSellSummary]);

  const isDirty = Boolean(activeScenarioId) && currentInputsHash !== lastSavedHash;
  const hasUnsavedTargetPrices = useMemo(
    () =>
      Boolean(activeScenarioId) &&
      computeInputsHash(targetPrices, [], []) !== computeInputsHash(lastSyncedTargetPrices, [], []),
    [activeScenarioId, lastSyncedTargetPrices, targetPrices],
  );
  const targetSaveUiActive = hasUnsavedTargetPrices && !isPersistingInputs;
  const hasTargetPrice2ToClear = useMemo(
    () =>
      Boolean(activeScenarioId) &&
      (Boolean(results?.hasSecondaryTargetPrices) ||
        (targetPrices || []).some((r) => num(r?.targetPrice2) > 0)),
    [activeScenarioId, results?.hasSecondaryTargetPrices, targetPrices],
  );

  useEffect(() => {
    if (!isDirty || isLoading || isScenarioLoading) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty, isLoading, isScenarioLoading]);

  useEffect(() => {
    if (!hypoBuyAddMenuOpen) return;
    function onDocMouseDown(e) {
      if (hypoBuyMenuWrapRef.current && !hypoBuyMenuWrapRef.current.contains(e.target)) {
        setHypoBuyAddMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [hypoBuyAddMenuOpen]);

  useEffect(() => {
    if (!hypoSellAddMenuOpen) return;
    function onDocMouseDown(e) {
      if (hypoSellMenuWrapRef.current && !hypoSellMenuWrapRef.current.contains(e.target)) {
        setHypoSellAddMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [hypoSellAddMenuOpen]);

  useEffect(() => {
    if (
      !hypoBuyStockModalOpen &&
      !hypoBuyCryptoModalOpen &&
      !hypoBuyCsvModalOpen &&
      !hypoSellStockModalOpen &&
      !hypoSellCryptoModalOpen
    )
      return;
    function onKey(e) {
      if (e.key === 'Escape') {
        setHypoBuyStockModalOpen(false);
        setHypoBuyCryptoModalOpen(false);
        setHypoBuyCsvModalOpen(false);
        setHypoSellStockModalOpen(false);
        setHypoSellCryptoModalOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    hypoBuyStockModalOpen,
    hypoBuyCryptoModalOpen,
    hypoBuyCsvModalOpen,
    hypoSellStockModalOpen,
    hypoSellCryptoModalOpen,
  ]);

  async function saveAfterHypotheticalChange(nextBuyRows, nextSellRows) {
    if (!activeScenarioIdRef.current || blockInputPersistRef.current) return;
    const sid = activeScenarioIdRef.current;
    const tp = cloneSyncedTargetRows(lastSyncedTargetPricesRef.current);
    const sr = nextSellRows ?? sellRowsRef.current;
    try {
      const savedHash = await persistScenarioInputs(sid, tp, nextBuyRows, sr);
      if (savedHash === false || activeScenarioIdRef.current !== sid) return;
      setLastSavedHash(savedHash);
      setError('');
    } catch (err) {
      if (activeScenarioIdRef.current === sid) {
        setError(err?.message || t('errors.failedUpdate'));
      }
    }
  }

  async function saveTargetPricesNow() {
    if (!activeScenarioIdRef.current || blockInputPersistRef.current) return;
    const tp = cloneSyncedTargetRows(targetPricesRef.current);
    const synced = lastSyncedTargetPricesRef.current;
    if (computeInputsHash(tp, [], []) === computeInputsHash(synced, [], [])) return;
    const sid = activeScenarioIdRef.current;
    const br = buyRowsRef.current;
    const sr = sellRowsRef.current;
    try {
      const savedHash = await persistScenarioInputs(sid, tp, br, sr);
      if (savedHash === false || activeScenarioIdRef.current !== sid) return;
      setLastSavedHash(savedHash);
      setLastSyncedTargetPrices(tp);
      setError('');
    } catch (err) {
      if (activeScenarioIdRef.current === sid) {
        setError(err?.message || t('errors.failedUpdate'));
      }
    }
  }

  async function clearAllTargetPrice2AndSave() {
    if (!activeScenarioIdRef.current || blockInputPersistRef.current) return;
    if (
      !results?.hasSecondaryTargetPrices &&
      !(targetPricesRef.current || []).some((r) => num(r?.targetPrice2) > 0)
    ) {
      return;
    }
    const sid = activeScenarioIdRef.current;
    const br = buyRowsRef.current;
    const sr = sellRowsRef.current;
    const beforeRows = cloneSyncedTargetRows(targetPricesRef.current);
    const baselineRows = Array.isArray(results?.rows) ? results.rows : [];
    const clearedRows = beforeRows.map((r) => ({ ...r, targetPrice2: '' }));
    setTargetPrices(clearedRows);
    setTargetPrice2PctBySymbol({});
    try {
      const savedHash = await persistScenarioInputs(sid, clearedRows, br, sr);
      if (savedHash === false || activeScenarioIdRef.current !== sid) return;
      setLastSavedHash(savedHash);
      setLastSyncedTargetPrices(cloneSyncedTargetRows(clearedRows));
      setError('');
    } catch (err) {
      if (activeScenarioIdRef.current === sid) {
        setTargetPrices(beforeRows);
        setTargetPrice2PctBySymbol(buildTargetPrice2PctMap(beforeRows, baselineRows));
        setError(err?.message || t('errors.failedUpdate'));
      }
    }
  }

  function cancelTargetPriceEdits() {
    if (!activeScenarioId || !hasUnsavedTargetPrices || isPersistingInputs) return;
    const synced = cloneSyncedTargetRows(lastSyncedTargetPricesRef.current);
    setTargetPrices(synced);
    const savedTargets = Array.isArray(results?.targetPrices) ? results.targetPrices : [];
    const savedBySymbol = new Map(savedTargets.map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const rows = Array.isArray(results?.rows) ? results.rows : [];
    const pctBySymbol = {};
    const pct2BySymbol = {};
    for (const row of rows) {
      const symbol = String(row.symbol || '').toUpperCase();
      const baseline = num(row.baselinePrice);
      const saved = savedBySymbol.get(symbol);
      const syncRow = synced.find((x) => String(x.symbol).toUpperCase() === symbol);
      const target = syncRow?.targetPrice;
      const targetNum = num(target);
      pctBySymbol[symbol] =
        saved && baseline > 0 && target !== ''
          ? (((targetNum - baseline) / baseline) * 100).toFixed(2)
          : '';
      const t2 = syncRow?.targetPrice2;
      const t2Num = num(t2);
      pct2BySymbol[symbol] =
        saved && baseline > 0 && num(saved?.targetPrice2) > 0 && t2 !== ''
          ? (((t2Num - baseline) / baseline) * 100).toFixed(2)
          : '';
    }
    setTargetPricePctBySymbol(pctBySymbol);
    setTargetPrice2PctBySymbol(pct2BySymbol);
    setError('');
  }

  function handleTargetPriceFieldKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void saveTargetPricesNow();
  }

  function removeBuyRow(index) {
    setBuyRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(next, sellRowsRef.current);
      });
      return next;
    });
  }

  function addStockHypotheticalBuyToList() {
    const symbol = normalizeText(stockForm.selectedSymbol).toUpperCase();
    const qty = num(stockForm.qty);
    const buyPrice = num(stockForm.buyPrice);
    if (!symbol) {
      setError(t('errors.selectStockSymbol'));
      return false;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return false;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setError(t('errors.avgCostNonNegative'));
      return false;
    }
    setError('');
    setBuyRows((prev) => {
      const next = [
        ...prev,
        { id: `stock-${Date.now()}`, assetClass: 'stock', symbol, qty, buyPrice, currency: 'USD' },
      ];
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(next, sellRowsRef.current);
      });
      return next;
    });
    setStockForm((prev) => ({ ...prev, qty: '', buyPrice: '' }));
    requestAnimationFrame(() => stockHypotheticalQtyRef.current?.focus?.());
    return true;
  }

  function resetStockHypotheticalForm() {
    setError('');
    setStockForm(emptyStockForm());
  }

  function addCryptoHypotheticalBuyToList() {
    const selected = cryptoProducts.find((item) => item.productId === cryptoForm.selectedProductId);
    const qty = num(cryptoForm.qty);
    const buyPrice = num(cryptoForm.buyPrice);
    if (!selected) {
      setError(t('errors.selectCoinbaseProduct'));
      return false;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return false;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setError(t('errors.avgCostNonNegative'));
      return false;
    }
    setError('');
    setBuyRows((prev) => {
      const next = [
        ...prev,
        {
          id: `crypto-${Date.now()}`,
          assetClass: 'crypto',
          symbol: String(selected.baseCurrency || '').toUpperCase(),
          qty,
          buyPrice,
          currency: String(selected.quoteCurrency || 'USD').toUpperCase(),
          productId: selected.productId,
        },
      ];
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(next, sellRowsRef.current);
      });
      return next;
    });
    setCryptoForm((prev) => ({ ...prev, qty: '', buyPrice: '' }));
    requestAnimationFrame(() => cryptoHypotheticalQtyRef.current?.focus?.());
    return true;
  }

  function resetCryptoHypotheticalForm() {
    setError('');
    setCryptoForm(emptyCryptoForm());
  }

  function importHypotheticalBuysFromCsv() {
    if (!activeScenarioIdRef.current || blockInputPersistRef.current) return false;
    const parsed = parseHypotheticalBuyCsv(hypoBuyCsvText);
    if (!parsed.ok) {
      setError(t(parsed.messageKey, parsed.vars));
      return false;
    }
    setError('');
    const baseTs = Date.now();
    setBuyRows((prev) => {
      const appended = parsed.rows.map((r, i) => ({
        id: `csv-${baseTs}-${i}`,
        assetClass: r.assetClass,
        symbol: r.symbol,
        qty: r.qty,
        buyPrice: r.buyPrice,
        currency: r.currency,
      }));
      const next = [...prev, ...appended];
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(next, sellRowsRef.current);
      });
      return next;
    });
    setHypoBuyCsvText('');
    return true;
  }

  function resetStockSellForm() {
    setError('');
    setStockSellForm(emptyStockSellForm());
  }

  function resetCryptoSellForm() {
    setError('');
    setCryptoSellForm(emptyCryptoSellForm());
  }

  function removeSellRow(index) {
    setSellRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(buyRowsRef.current, next);
      });
      return next;
    });
  }

  /** Removes all hypothetical buy lines for one aggregate (symbol + quote bucket); one PUT /inputs. */
  function batchRemoveHypotheticalBuysForAggregate(aggKey, symbolLabel) {
    if (!aggKey) return;
    if (!window.confirm(t('whatif.batchDeleteHypotheticalBuysConfirm', { symbol: symbolLabel }))) return;
    setBuyRows((prev) => {
      const next = prev.filter((r) => hypoBuyAggregateKey(r) !== aggKey);
      if (next.length === prev.length) return prev;
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(next, sellRowsRef.current);
      });
      return next;
    });
    setExpandedHypoBuyKeys((prev) => {
      if (!prev.has(aggKey)) return prev;
      const n = new Set(prev);
      n.delete(aggKey);
      return n;
    });
  }

  /** Removes all hypothetical sale lines for one aggregate (symbol + quote bucket); one PUT /inputs. */
  function batchRemoveHypotheticalSellsForAggregate(aggKey, symbolLabel) {
    if (!aggKey) return;
    if (!window.confirm(t('whatif.batchDeleteHypotheticalSalesConfirm', { symbol: symbolLabel }))) return;
    setSellRows((prev) => {
      const next = prev.filter((r) => hypoSellAggregateKey(r) !== aggKey);
      if (next.length === prev.length) return prev;
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(buyRowsRef.current, next);
      });
      return next;
    });
    setExpandedHypoSellKeys((prev) => {
      if (!prev.has(aggKey)) return prev;
      const n = new Set(prev);
      n.delete(aggKey);
      return n;
    });
  }

  function openHypoBuyModalForAggregate(aggKey) {
    if (!activeScenarioId || isPersistingInputs) return;
    setError('');
    const sample = buyRows.find((r) => hypoBuyAggregateKey(r) === aggKey);
    const sym = sample
      ? String(sample.symbol || '').trim().toUpperCase()
      : String(aggKey.split('\0')[0] || '').trim().toUpperCase();
    if (!sym) return;
    const isCrypto = sample?.assetClass === 'crypto';
    if (!isCrypto) {
      setStockForm({
        query: sym,
        selectedSymbol: sym,
        qty: '',
        buyPrice: '',
      });
      setHypoBuyStockModalOpen(true);
      return;
    }
    const pid = sample?.productId ? String(sample.productId) : '';
    setCryptoForm({
      query: pid || sym,
      selectedProductId: pid,
      qty: '',
      buyPrice: '',
    });
    setHypoBuyCryptoModalOpen(true);
  }

  function openHypoSellModalForAggregate(aggKey) {
    if (!activeScenarioId || isPersistingInputs) return;
    setError('');
    const sample = sellRows.find((r) => hypoSellAggregateKey(r) === aggKey);
    const sym = sample
      ? String(sample.symbol || '').trim().toUpperCase()
      : String(aggKey.split('\0')[0] || '').trim().toUpperCase();
    if (!sym) return;
    const isCrypto = sample?.assetClass === 'crypto';
    const avail = sellFormAvailableQtyForSymbol(sym);
    const priceStr = marketPriceDefaultStringForSymbol(portfolioTableRows, sym);
    if (!isCrypto) {
      setStockSellForm({
        selectedSymbol: sym,
        sellPct: 0,
        qty: '',
        sellPrice: priceStr,
      });
      setHypoSellStockModalOpen(true);
      return;
    }
    setCryptoSellForm({
      selectedSymbol: sym,
      sellPct: 0,
      qty: '',
      sellPrice: priceStr,
    });
    setHypoSellCryptoModalOpen(true);
  }

  function addStockHypotheticalSellToList() {
    const symbol = normalizeText(stockSellForm.selectedSymbol).toUpperCase();
    const qty = num(stockSellForm.qty);
    const sellPrice = num(stockSellForm.sellPrice);
    if (!symbol) {
      setError(t('errors.selectStockSymbol'));
      return false;
    }
    const inHoldings = stockHoldingsForSell.some((h) => String(h.symbol || '').toUpperCase() === symbol);
    if (!inHoldings) {
      setError(t('whatif.selectHoldingToSell'));
      return false;
    }
    const uiMax = sellFormAvailableQtyForSymbol(symbol);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return false;
    }
    if (qty > uiMax + 1e-9) {
      setError(t('whatif.sellQtyExceedsAvailable'));
      return false;
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setError(t('errors.sellPricePerUnitNonNegative'));
      return false;
    }
    setError('');
    setSellRows((prev) => {
      const next = [
        ...prev,
        {
          id: `sell-stock-${Date.now()}`,
          assetClass: 'stock',
          symbol,
          qty,
          sellPrice,
          currency: 'USD',
        },
      ];
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(buyRowsRef.current, next);
      });
      return next;
    });
    setStockSellForm((prev) => ({ ...prev, qty: '', sellPrice: '', sellPct: 0 }));
    requestAnimationFrame(() => stockSellQtyRef.current?.focus?.());
    return true;
  }

  function addCryptoHypotheticalSellToList() {
    const symbol = normalizeText(cryptoSellForm.selectedSymbol).toUpperCase();
    const holding = cryptoHoldingsForSell.find((h) => String(h.symbol || '').toUpperCase() === symbol);
    const qty = num(cryptoSellForm.qty);
    const sellPrice = num(cryptoSellForm.sellPrice);
    if (!holding || !symbol) {
      setError(t('whatif.selectHoldingToSell'));
      return false;
    }
    const uiMax = sellFormAvailableQtyForSymbol(symbol);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t('errors.quantityGreaterZero'));
      return false;
    }
    if (qty > uiMax + 1e-9) {
      setError(t('whatif.sellQtyExceedsAvailable'));
      return false;
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setError(t('errors.sellPricePerUnitNonNegative'));
      return false;
    }
    const currency = String(holding.currency || 'USD').toUpperCase();
    setError('');
    setSellRows((prev) => {
      const next = [
        ...prev,
        {
          id: `sell-crypto-${Date.now()}`,
          assetClass: 'crypto',
          symbol,
          qty,
          sellPrice,
          currency,
        },
      ];
      queueMicrotask(() => {
        void saveAfterHypotheticalChange(buyRowsRef.current, next);
      });
      return next;
    });
    setCryptoSellForm((prev) => ({ ...prev, qty: '', sellPrice: '', sellPct: 0 }));
    requestAnimationFrame(() => cryptoSellQtyRef.current?.focus?.());
    return true;
  }

  const resultRows = Array.isArray(results?.rows) ? results.rows : [];
  const hasSecondaryTargetPrices = Boolean(results?.hasSecondaryTargetPrices);
  const weightChartRows = useMemo(() => {
    const raw = Array.isArray(results?.rows) ? results.rows : [];
    const dual = Boolean(results?.hasSecondaryTargetPrices);
    return [...raw]
      .sort((a, b) => String(a.symbol || '').localeCompare(String(b.symbol || '')))
      .map((row) => {
        const scenarioQty = num(row.qty);
        const scenarioPrice = num(row.scenarioPrice);
        const scenarioValue = num(row.scenarioValue);
        const scenarioPrice2 = dual ? num(row.scenarioPrice2) : 0;
        const scenarioValue2 = dual ? num(row.scenarioValue2) : 0;
        const scenarioWeight2 = dual ? Number(row.scenarioWeightPct2) || 0 : 0;
        const baselineW = Number(row.baselineWeightPct) || 0;
        const currency = String(row.currency || 'USD').trim() || 'USD';
        return {
          name: String(row.symbol || ''),
          baselineWeight: baselineW,
          scenarioWeight: Number(row.scenarioWeightPct) || 0,
          deltaVsBaseline: (Number(row.scenarioWeightPct) || 0) - baselineW,
          scenarioWeight2,
          delta2VsBaseline: dual ? scenarioWeight2 - baselineW : 0,
          scenarioQty,
          scenarioPrice,
          scenarioValue,
          scenarioPrice2,
          scenarioValue2,
          currency,
        };
      });
  }, [results]);

  const formatWeightBarLabel = useCallback(
    (value) => {
      if (hideValues) return '';
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '';
      return `${n.toFixed(1)}%`;
    },
    [hideValues],
  );

  const unsavedTargetSymbolSet = useMemo(() => {
    const set = new Set();
    for (const row of resultRows) {
      const sym = String(row.symbol || '').toUpperCase();
      if (!sym) continue;
      const d = normalizedPositiveTargetFromRows(targetPrices, sym);
      const s = normalizedPositiveTargetFromRows(lastSyncedTargetPrices, sym);
      const d2 = normalizedPositiveTarget2FromRows(targetPrices, sym);
      const s2 = normalizedPositiveTarget2FromRows(lastSyncedTargetPrices, sym);
      if (d !== s || d2 !== s2) set.add(sym);
    }
    return set;
  }, [resultRows, targetPrices, lastSyncedTargetPrices]);

  const baselineTotal = num(results?.baseline?.totalValue);
  const baselineCostBasis = num(results?.baseline?.totalCost);
  const baselineUnrealized = baselineTotal - baselineCostBasis;
  const baselineUnrealizedPct = baselineCostBasis > 0 ? (baselineUnrealized / baselineCostBasis) * 100 : 0;
  const scenarioTotal = num(results?.scenarioTotals?.value);
  const scenarioCostBasis = num(results?.scenarioTotals?.cost);
  const scenarioUnrealized = num(results?.scenarioTotals?.pnl);
  const scenarioUnrealizedPct = scenarioCostBasis > 0 ? (scenarioUnrealized / scenarioCostBasis) * 100 : 0;
  const unrealizedDelta = scenarioUnrealized - baselineUnrealized;
  const unrealizedDeltaPct = scenarioUnrealizedPct - baselineUnrealizedPct;
  const portfolioValueDelta = scenarioTotal - baselineTotal;
  const costBasisDelta = scenarioCostBasis - baselineCostBasis;
  const baselineNetWorth = num(netWorth?.overview?.totalNetWorth);
  const portfolioDeltaInBase = num(results?.portfolioBaseTotals?.deltaValue);
  const hypotheticalCostBase = num(results?.portfolioBaseTotals?.hypotheticalCostBase);
  const hypotheticalProceedsBase = num(results?.portfolioBaseTotals?.hypotheticalProceedsBase);
  const scenarioNetWorth =
    baselineNetWorth +
    portfolioDeltaInBase +
    (adjustScenarioCashForHypotheticals ? hypotheticalProceedsBase - hypotheticalCostBase : 0);
  const netWorthDelta = scenarioNetWorth - baselineNetWorth;
  const netWorthDeltaPct = baselineNetWorth > 0 ? (netWorthDelta / baselineNetWorth) * 100 : 0;

  const scenarioTotal2 = num(results?.scenarioTotals2?.value);
  const scenarioUnrealized2 = num(results?.scenarioTotals2?.pnl);
  const scenarioUnrealizedPct2 = scenarioCostBasis > 0 ? (scenarioUnrealized2 / scenarioCostBasis) * 100 : 0;
  const unrealizedDelta2 = scenarioUnrealized2 - baselineUnrealized;
  const unrealizedDeltaPct2 = scenarioUnrealizedPct2 - baselineUnrealizedPct;
  const portfolioValueDelta2 = scenarioTotal2 - baselineTotal;
  const portfolioDeltaInBase2 = num(results?.portfolioBaseTotals?.deltaValue2);
  const scenarioNetWorth2 =
    baselineNetWorth +
    portfolioDeltaInBase2 +
    (adjustScenarioCashForHypotheticals ? hypotheticalProceedsBase - hypotheticalCostBase : 0);
  const netWorthDelta2 = scenarioNetWorth2 - baselineNetWorth;
  const netWorthDeltaPct2 = baselineNetWorth > 0 ? (netWorthDelta2 / baselineNetWorth) * 100 : 0;

  const hypoPurchaseFunding = useMemo(() => {
    const requiredMap = sumHypotheticalBuyCostByQuoteBucket(buyRows);
    let totalRequired = 0;
    for (const v of requiredMap.values()) totalRequired += v;
    if (!(totalRequired > 1e-9)) return null;

    const cashRows = Array.isArray(netWorth?.overview?.cashRows) ? netWorth.overview.cashRows : [];
    const cashMap = sumCashByQuoteBucket(cashRows);
    const proceedsMap = sumHypotheticalSaleProceedsByQuoteBucket(sellRows);

    const bucketSet = new Set([...requiredMap.keys(), ...cashMap.keys(), ...proceedsMap.keys()]);
    const rows = [...bucketSet]
      .sort((a, b) => a.localeCompare(b))
      .map((bucket) => {
        const cash = cashMap.get(bucket) ?? 0;
        const proceeds = proceedsMap.get(bucket) ?? 0;
        const required = requiredMap.get(bucket) ?? 0;
        const available = cash + proceeds;
        const balance = available - required;
        return { bucket, cash, proceeds, required, available, balance };
      })
      .filter((r) => r.proceeds > 1e-9 || r.required > 1e-9);

    const shortBuckets = [];
    let covered = true;
    for (const [bucket, req] of requiredMap.entries()) {
      if (!(req > 1e-9)) continue;
      const cash = cashMap.get(bucket) ?? 0;
      const proc = proceedsMap.get(bucket) ?? 0;
      const balance = cash + proc - req;
      if (balance < -1e-6) {
        covered = false;
        shortBuckets.push({ bucket, shortfall: -balance });
      }
    }

    return { rows, covered, shortBuckets };
  }, [buyRows, sellRows, netWorth?.overview?.cashRows]);

  const isBusy = isLoading || isScenarioLoading || isSaving;
  const showAutosaveStickyBar = Boolean(activeScenarioId) && !isLoading && !isScenarioLoading;

  return (
    <section className="contentWrap">
      <header className="pageHeader">
        <h1>{t('whatif.title')}</h1>
      </header>

      <div className="dashboardPanel whatIfPanel">
        {isLoading && <p>{t('app.loadingDashboard')}</p>}
        {!isLoading && error && <p className="error">{error}</p>}
        {!isLoading && (
          <>
            {isBusy && (
              <div className="whatIfBusyOverlay" role="status" aria-live="polite">
                <div className="whatIfBusyOverlayCard">
                  <div className="whatIfBusySpinner" aria-hidden="true" />
                  <div className="whatIfBusyText">
                    {isSaving ? t('modals.saving') : t('app.loadingDashboard')}
                  </div>
                </div>
              </div>
            )}
            <section className="whatIfSection whatIfSection--scenarios" aria-labelledby="whatif-scenarios-heading">
              <div className="whatIfScenarioShell">
                <header className="whatIfScenarioShellHead">
                  <div className="whatIfScenarioShellTitleRow">
                    <h2 className="whatIfScenarioPageTitle" id="whatif-scenarios-heading">
                      {t('whatif.scenarios')}
                    </h2>
                  </div>
                  {scenarios.length === 0 && !isLoading && (
                    <p className="whatIfScenarioZeroHint">{t('whatif.scenarioZeroHint')}</p>
                  )}
                </header>

                <div className="whatIfScenarioControls">
                  <div className="whatIfScenarioSelectBlock">
                    <label className="whatIfScenarioPicker">
                      <span className="whatIfScenarioPickerLabel">{t('whatif.activeScenarioLabel')}</span>
                      <div className="whatIfScenarioSelectInner">
                        <select
                          id="whatif-scenario-select"
                          className="profitabilitySelect whatIfScenarioSelect"
                          value={activeScenarioId}
                          onChange={(e) => handleActivateScenario(e.target.value)}
                          disabled={isBusy}
                        >
                          <option value="">{t('whatif.selectScenario')}</option>
                          {scenarios.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                  </div>

                  <div
                    className="whatIfScenarioNameActions"
                    role="toolbar"
                    aria-label={t('whatif.scenarioToolbarAria')}
                  >
                    {isAddingScenario ? (
                      <>
                        <input
                          className="profitabilityInput whatIfScenarioInlineInput"
                          value={newScenarioName}
                          onChange={(e) => setNewScenarioName(e.target.value)}
                          placeholder={t('whatif.newScenarioPlaceholder')}
                          maxLength={120}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateScenario();
                            if (e.key === 'Escape') {
                              setIsAddingScenario(false);
                              setNewScenarioName('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn whatIfScenarioToolBtn--confirm headerIconBtn whatIfIconBtn"
                          onClick={handleCreateScenario}
                          disabled={isBusy || !String(newScenarioName || '').trim()}
                          aria-label={t('modals.save')}
                          title={t('modals.save')}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn headerIconBtn whatIfIconBtn"
                          onClick={() => {
                            setIsAddingScenario(false);
                            setNewScenarioName('');
                          }}
                          disabled={isBusy}
                          aria-label={t('modals.cancel')}
                          title={t('modals.cancel')}
                        >
                          ×
                        </button>
                      </>
                    ) : isRenamingScenario ? (
                      <>
                        <input
                          className="profitabilityInput whatIfScenarioDupNameInput whatIfScenarioInlineInput"
                          value={renameScenarioName}
                          onChange={(e) => setRenameScenarioName(e.target.value)}
                          placeholder={t('whatif.renameScenarioPlaceholder')}
                          maxLength={120}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameScenario();
                            if (e.key === 'Escape') {
                              setIsRenamingScenario(false);
                              setRenameScenarioName('');
                              setError('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn whatIfScenarioToolBtn--confirm headerIconBtn whatIfIconBtn"
                          onClick={handleRenameScenario}
                          disabled={isBusy || !String(renameScenarioName || '').trim()}
                          aria-label={t('modals.save')}
                          title={t('modals.save')}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn headerIconBtn whatIfIconBtn"
                          onClick={() => {
                            setIsRenamingScenario(false);
                            setRenameScenarioName('');
                            setError('');
                          }}
                          disabled={isBusy}
                          aria-label={t('modals.cancel')}
                          title={t('modals.cancel')}
                        >
                          ×
                        </button>
                      </>
                    ) : isDuplicatingScenario ? (
                      <>
                        <input
                          className="profitabilityInput whatIfScenarioDupNameInput whatIfScenarioInlineInput"
                          value={duplicateScenarioName}
                          onChange={(e) => setDuplicateScenarioName(e.target.value)}
                          placeholder={t('whatif.duplicateScenarioPlaceholder')}
                          maxLength={120}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleDuplicateScenario();
                            if (e.key === 'Escape') {
                              setIsDuplicatingScenario(false);
                              setDuplicateScenarioName('');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn whatIfScenarioToolBtn--confirm headerIconBtn whatIfIconBtn"
                          onClick={handleDuplicateScenario}
                          disabled={isBusy || !String(duplicateScenarioName || '').trim()}
                          aria-label={t('modals.save')}
                          title={t('modals.save')}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn headerIconBtn whatIfIconBtn"
                          onClick={() => {
                            setIsDuplicatingScenario(false);
                            setDuplicateScenarioName('');
                          }}
                          disabled={isBusy}
                          aria-label={t('modals.cancel')}
                          title={t('modals.cancel')}
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn whatIfScenarioToolBtn--accent headerIconBtn whatIfIconBtn"
                          onClick={() => {
                            setIsDuplicatingScenario(false);
                            setDuplicateScenarioName('');
                            setIsRenamingScenario(false);
                            setRenameScenarioName('');
                            setIsAddingScenario(true);
                          }}
                          disabled={isBusy}
                          aria-label={t('whatif.createScenario')}
                          title={t('whatif.createScenario')}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn headerIconBtn whatIfIconBtn"
                          onClick={openDuplicateScenario}
                          disabled={!activeScenarioId || isBusy}
                          aria-label={t('whatif.duplicateScenario')}
                          title={t('whatif.duplicateScenario')}
                        >
                          <svg
                            className="whatIfDupIcon"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <rect x="9" y="9" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
                            <rect x="4" y="4" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="whatIfScenarioToolBtn headerIconBtn whatIfIconBtn"
                          onClick={openRenameScenario}
                          disabled={!activeScenarioId || isBusy}
                          aria-label={t('whatif.renameScenario')}
                          title={t('whatif.renameScenario')}
                        >
                          <svg
                            className="whatIfRenameIcon"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <path
                              d="M12 20h8M4 13l9-9 3 3-9 9H4v-3z"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="whatIfScenarioToolBtn whatIfScenarioToolBtn--danger headerIconBtn whatIfIconBtn positionActionBtnDanger"
                      onClick={handleDeleteScenario}
                      disabled={!activeScenarioId || isBusy}
                      aria-label={t('whatif.deleteScenario')}
                      title={t('whatif.deleteScenario')}
                    >
                      <svg
                        className="whatIfScenarioTrashIcon"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {activeScenarioId && (
              <>
                <section className="whatIfSection whatIfSection--hypoBuy">
                  <header className="whatIfHypoSectionHead">
                    <div className="whatIfHypoSectionHeadRow">
                      <span className="whatIfHypoBadge whatIfHypoBadge--buy">{t('whatif.hypoSectionBadgeBuy')}</span>
                      <div className="whatIfHypoAddMenuWrap" ref={hypoBuyMenuWrapRef}>
                        <button
                          type="button"
                          className="headerIconBtn whatIfIconBtn whatIfHypoAddMenuTrigger"
                          aria-expanded={hypoBuyAddMenuOpen}
                          aria-haspopup="menu"
                          aria-label={t('whatif.hypoBuyAddMenuAria')}
                          title={t('whatif.hypoBuyAddMenuAria')}
                          onClick={() => setHypoBuyAddMenuOpen((o) => !o)}
                        >
                          +
                        </button>
                        {hypoBuyAddMenuOpen && (
                          <div className="whatIfHypoAddMenu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="whatIfHypoAddMenuItem"
                              onClick={() => {
                                setHypoBuyAddMenuOpen(false);
                                setHypoBuyStockModalOpen(true);
                              }}
                            >
                              {t('whatif.hypoBuyMenuStock')}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="whatIfHypoAddMenuItem"
                              onClick={() => {
                                setHypoBuyAddMenuOpen(false);
                                setHypoBuyCryptoModalOpen(true);
                              }}
                            >
                              {t('whatif.hypoBuyMenuCrypto')}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="whatIfHypoAddMenuItem"
                              onClick={() => {
                                setHypoBuyAddMenuOpen(false);
                                setHypoBuyCsvModalOpen(true);
                              }}
                            >
                              {t('whatif.hypoBuyMenuCsv')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </header>

                  <div className="whatIfHypotheticalAggregateWrap whatIfHypotheticalAggregateWrap--buyCards">
                    <div className="whatIfHypoAggregateDesktopTable">
                      <div className="profitabilityTableWrap">
                        <table className="profitabilityTable whatIfTable whatIfHypoAggDesktopTable whatIfHypoAggDesktopTable--buy">
                          <thead>
                            <tr>
                              <th className="whatIfHypoAggDesktopExpandCol" scope="col" aria-label="expand">
                                {' '}
                              </th>
                              <th scope="col">{t('portfolio.asset')}</th>
                              <th scope="col">{t('portfolio.quantity')}</th>
                              <th scope="col">{t('portfolio.totalCostBasis')}</th>
                              <th scope="col">{t('portfolio.avgCostPerUnit')}</th>
                              <th scope="col">{t('whatif.hypoAggregateLineCountLabel')}</th>
                              <th
                                className="whatIfHypoAggDesktopActionsCol"
                                scope="col"
                                aria-label={t('whatif.hypoAggActionsColumn')}
                              >
                                {' '}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {aggregatedHypotheticalBuys.map((row) => {
                              const aggKey = `${row.symbol}\0${row.currency}`;
                              const isOpen = expandedHypoBuyKeys.has(aggKey);
                              const lineCount = buyRows.reduce(
                                (n, r) => n + (hypoBuyAggregateKey(r) === aggKey ? 1 : 0),
                                0,
                              );
                              return (
                                <Fragment key={aggKey}>
                                  <tr className="whatIfHypoAggParentRow">
                                    <td data-label="">
                                      <button
                                        type="button"
                                        className="headerIconBtn positionExpandBtn"
                                        onClick={() =>
                                          setExpandedHypoBuyKeys((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(aggKey)) next.delete(aggKey);
                                            else next.add(aggKey);
                                            return next;
                                          })
                                        }
                                        disabled={lineCount === 0}
                                        aria-expanded={isOpen}
                                        aria-label={t('whatif.toggleHypotheticalBuyLines', { symbol: row.symbol })}
                                        title={
                                          isOpen
                                            ? t('whatif.hideHypotheticalBuyLines')
                                            : t('whatif.showHypotheticalBuyLines')
                                        }
                                      >
                                        {isOpen ? '▾' : '▸'}
                                      </button>
                                    </td>
                                    <td data-label={t('portfolio.asset')}>{row.symbol}</td>
                                    <td data-label={t('portfolio.quantity')}>
                                      {hideValues ? '—' : formatQty(row.totalQty)}
                                    </td>
                                    <td data-label={t('portfolio.totalCostBasis')}>
                                      {hideValues ? '—' : formatCurrencyValue(row.totalCost, row.currency)}
                                    </td>
                                    <td data-label={t('portfolio.avgCostPerUnit')}>
                                      {hideValues ? '—' : formatCurrencyValue(row.avgCost, row.currency)}
                                    </td>
                                    <td data-label={t('whatif.hypoAggregateLineCountLabel')}>{lineCount}</td>
                                    <td
                                      className="whatIfHypoAggDesktopActionsCol"
                                      data-label={t('whatif.hypoAggActionsColumn')}
                                    >
                                      <div className="whatIfHypoAggActionsCell">
                                        <button
                                          type="button"
                                          className="headerIconBtn whatIfIconBtn whatIfHypoAggAddBtn"
                                          onClick={() => openHypoBuyModalForAggregate(aggKey)}
                                          disabled={lineCount === 0 || !activeScenarioId || isBusy}
                                          aria-label={t('whatif.hypoAggQuickAddBuyAria', { symbol: row.symbol })}
                                          title={t('whatif.hypoAggQuickAddBuyAria', { symbol: row.symbol })}
                                        >
                                          +
                                        </button>
                                        <button
                                          type="button"
                                          className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                          onClick={() => batchRemoveHypotheticalBuysForAggregate(aggKey, row.symbol)}
                                          disabled={lineCount === 0 || isPersistingInputs}
                                          aria-label={t('whatif.batchDeleteHypotheticalBuysAria', { symbol: row.symbol })}
                                          title={t('whatif.batchDeleteHypotheticalBuysAria', { symbol: row.symbol })}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  {isOpen && lineCount > 0 && (
                                    <tr className="whatIfHypoAggNestedRow">
                                      <td colSpan={7}>
                                        <div className="whatIfHypoNestedTableWrap">
                                          <table className="whatIfHypoNestedLinesTable">
                                            <thead>
                                              <tr>
                                                <th scope="col">{t('whatif.simulatedBuyLinesSection')}</th>
                                                <th scope="col">{t('portfolio.quantity')}</th>
                                                <th scope="col">{t('modals.avgCostPerUnit')}</th>
                                                <th scope="col">{t('portfolio.totalCostBasis')}</th>
                                                <th
                                                  className="whatIfHypoNestedLinesTableActionsCol"
                                                  scope="col"
                                                  aria-label={t('modals.remove')}
                                                >
                                                  {' '}
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {buyRows
                                                .map((r, index) => ({ r, index }))
                                                .filter(({ r }) => hypoBuyAggregateKey(r) === aggKey)
                                                .map(({ r, index }, i) => {
                                                  const quoteCcy = hypotheticalBuyQuoteCurrency(r);
                                                  const lineCost = num(r.qty) * num(r.buyPrice);
                                                  const lineNo = i + 1;
                                                  return (
                                                    <tr key={r.id || `hypo-buy-${aggKey}-${index}`}>
                                                      <td data-label={t('whatif.simulatedBuyLinesSection')}>
                                                        {t('whatif.simulatedBuyLineLabel', { n: lineNo })}
                                                      </td>
                                                      <td data-label={t('portfolio.quantity')}>
                                                        {hideValues ? '—' : formatQty(r.qty)}
                                                      </td>
                                                      <td data-label={t('modals.avgCostPerUnit')}>
                                                        {hideValues
                                                          ? '—'
                                                          : formatCurrencyValue(r.buyPrice, quoteCcy)}
                                                      </td>
                                                      <td data-label={t('portfolio.totalCostBasis')}>
                                                        {hideValues
                                                          ? '—'
                                                          : formatCurrencyValue(lineCost, quoteCcy)}
                                                      </td>
                                                      <td data-label={t('modals.remove')}>
                                                        <button
                                                          type="button"
                                                          className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                                          onClick={() => removeBuyRow(index)}
                                                          aria-label={t('modals.remove')}
                                                          title={t('modals.remove')}
                                                        >
                                                          ✕
                                                        </button>
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                            {aggregatedHypotheticalBuys.length === 0 && (
                              <tr>
                                <td colSpan={7}>{t('whatif.hypotheticalAggregateEmpty')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="whatIfHypoAggregateMobileCards">
                    <div className="positionClassCards whatIfHypoBuyParentCards">
                      {aggregatedHypotheticalBuys.map((row) => {
                        const aggKey = `${row.symbol}\0${row.currency}`;
                        const isOpen = expandedHypoBuyKeys.has(aggKey);
                        const lineCount = buyRows.reduce(
                          (n, r) => n + (hypoBuyAggregateKey(r) === aggKey ? 1 : 0),
                          0,
                        );
                        return (
                          <section
                            key={aggKey}
                            className="positionDetailCard whatIfHypoBuyParentCard"
                          >
                            <header>
                              <div className="positionNameCol">
                                <div className="positionMobileTitleRow">
                                  <button
                                    type="button"
                                    className="headerIconBtn positionExpandBtn"
                                    onClick={() =>
                                      setExpandedHypoBuyKeys((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(aggKey)) next.delete(aggKey);
                                        else next.add(aggKey);
                                        return next;
                                      })
                                    }
                                    disabled={lineCount === 0}
                                    aria-expanded={isOpen}
                                    aria-label={t('whatif.toggleHypotheticalBuyLines', { symbol: row.symbol })}
                                    title={
                                      isOpen
                                        ? t('whatif.hideHypotheticalBuyLines')
                                        : t('whatif.showHypotheticalBuyLines')
                                    }
                                  >
                                    {isOpen ? '▾' : '▸'}
                                  </button>
                                  <h3>{row.symbol}</h3>
                                </div>
                                <span className="positionMarketMeta">
                                  {t('whatif.hypoAggregateBuyMeta', { count: lineCount })}
                                </span>
                              </div>
                              <div className="positionPnlDock whatIfHypoAggregateDock">
                                <strong>
                                  {hideValues ? '—' : formatCurrencyValue(row.totalCost, row.currency)}
                                </strong>
                                <span>{hideValues ? '—' : formatQty(row.totalQty)}</span>
                              </div>
                            </header>
                            <div className="positionQuickGrid">
                              <div className="positionQuickItem">
                                <span>{t('portfolio.totalCostBasis')}</span>
                                <strong>
                                  {hideValues ? '—' : formatCurrencyValue(row.totalCost, row.currency)}
                                </strong>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('portfolio.avgCostPerUnit')}</span>
                                <strong>
                                  {hideValues ? '—' : formatCurrencyValue(row.avgCost, row.currency)}
                                </strong>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('portfolio.quantity')}</span>
                                <strong>{hideValues ? '—' : formatQty(row.totalQty)}</strong>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('whatif.hypoAggregateLineCountLabel')}</span>
                                <strong>{lineCount}</strong>
                              </div>
                            </div>
                            <dl className="positionMetaList whatIfHypoParentMetaActions">
                              <div className="positionMetaRowWithActions whatIfHypoMetaRowActionsOnly">
                                <div className="positionCardActionIcons">
                                  <button
                                    type="button"
                                    className="headerIconBtn whatIfIconBtn whatIfHypoAggAddBtn"
                                    onClick={() => openHypoBuyModalForAggregate(aggKey)}
                                    disabled={lineCount === 0 || !activeScenarioId || isBusy}
                                    aria-label={t('whatif.hypoAggQuickAddBuyAria', { symbol: row.symbol })}
                                    title={t('whatif.hypoAggQuickAddBuyAria', { symbol: row.symbol })}
                                  >
                                    +
                                  </button>
                                  <button
                                    type="button"
                                    className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                    onClick={() => batchRemoveHypotheticalBuysForAggregate(aggKey, row.symbol)}
                                    disabled={lineCount === 0 || isPersistingInputs}
                                    aria-label={t('whatif.batchDeleteHypotheticalBuysAria', { symbol: row.symbol })}
                                    title={t('whatif.batchDeleteHypotheticalBuysAria', { symbol: row.symbol })}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            </dl>
                            {isOpen && (
                              <div className="positionCardExpandedWrap">
                                <div className="positionTxPanel positionTxPanel--mobile whatIfHypoNestedPanel">
                                  <section className="positionTxSection positionTxSection--purchases">
                                    <div className="positionTxSectionHeader">
                                      <strong>{t('whatif.simulatedBuyLinesSection')}</strong>
                                    </div>
                                    <div className="positionTxCards">
                                      {buyRows
                                        .map((r, index) => ({ r, index }))
                                        .filter(({ r }) => hypoBuyAggregateKey(r) === aggKey)
                                        .map(({ r, index }, i) => {
                                          const quoteCcy = hypotheticalBuyQuoteCurrency(r);
                                          const lineCost = num(r.qty) * num(r.buyPrice);
                                          const lineNo = i + 1;
                                          return (
                                            <div
                                              key={r.id || `hypo-buy-${aggKey}-${index}`}
                                              className="positionTxCard"
                                            >
                                              <div className="positionTxCardTitleRow">
                                                <strong>{t('whatif.simulatedBuyLineLabel', { n: lineNo })}</strong>
                                                <button
                                                  type="button"
                                                  className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                                  onClick={() => removeBuyRow(index)}
                                                  aria-label={t('modals.remove')}
                                                  title={t('modals.remove')}
                                                >
                                                  ✕
                                                </button>
                                              </div>
                                              <div className="positionTxCardGrid">
                                                <div>
                                                  <span>{t('portfolio.quantity')}</span>
                                                  <strong>{hideValues ? '—' : formatQty(r.qty)}</strong>
                                                </div>
                                                <div>
                                                  <span>{t('modals.avgCostPerUnit')}</span>
                                                  <strong>
                                                    {hideValues
                                                      ? '—'
                                                      : formatCurrencyValue(r.buyPrice, quoteCcy)}
                                                  </strong>
                                                </div>
                                                <div>
                                                  <span>{t('portfolio.totalCostBasis')}</span>
                                                  <strong>
                                                    {hideValues
                                                      ? '—'
                                                      : formatCurrencyValue(lineCost, quoteCcy)}
                                                  </strong>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </section>
                                </div>
                              </div>
                            )}
                          </section>
                        );
                      })}
                      {aggregatedHypotheticalBuys.length === 0 && (
                        <p className="positionTxEmpty whatIfHypoAggregateEmpty">{t('whatif.noHypotheticalBuys')}</p>
                      )}
                    </div>
                    </div>
                      {aggregatedHypotheticalBuys.length > 0 &&
                        hypotheticalAggregateCostSubtotals.map(([currency, totalCost]) => (
                          <div
                            key={`hypo-agg-subtotal-${currency}`}
                            className="whatIfHypoSubtotalStrip whatIfHypoSubtotalStrip--buy"
                          >
                            <span className="whatIfHypoSubtotalStripLabel">
                              {hypotheticalAggregateCostSubtotals.length > 1
                                ? `${t('whatif.hypotheticalAggregateSubtotal')} (${currency})`
                                : t('whatif.hypotheticalAggregateSubtotal')}
                            </span>
                            <strong className="whatIfHypoSubtotalStripValue">
                              {hideValues ? '—' : formatCurrencyValue(totalCost, currency)}
                            </strong>
                          </div>
                        ))}
                  </div>
                </section>

                <section className="whatIfSection whatIfSection--hypoSell">
                  <header className="whatIfHypoSectionHead">
                    <div className="whatIfHypoSectionHeadRow">
                      <span className="whatIfHypoBadge whatIfHypoBadge--sell">{t('whatif.hypoSectionBadgeSell')}</span>
                      <div className="whatIfHypoAddMenuWrap" ref={hypoSellMenuWrapRef}>
                        <button
                          type="button"
                          className="headerIconBtn whatIfIconBtn whatIfHypoAddMenuTrigger whatIfHypoAddMenuTrigger--sell"
                          aria-expanded={hypoSellAddMenuOpen}
                          aria-haspopup="menu"
                          aria-label={t('whatif.hypoSellAddMenuAria')}
                          title={t('whatif.hypoSellAddMenuAria')}
                          onClick={() => setHypoSellAddMenuOpen((o) => !o)}
                        >
                          +
                        </button>
                        {hypoSellAddMenuOpen && (
                          <div className="whatIfHypoAddMenu whatIfHypoAddMenu--sell" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="whatIfHypoAddMenuItem"
                              onClick={() => {
                                setHypoSellAddMenuOpen(false);
                                setHypoSellStockModalOpen(true);
                              }}
                            >
                              {t('whatif.hypoSellMenuStock')}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="whatIfHypoAddMenuItem"
                              onClick={() => {
                                setHypoSellAddMenuOpen(false);
                                setHypoSellCryptoModalOpen(true);
                              }}
                            >
                              {t('whatif.hypoSellMenuCrypto')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </header>

                  <div className="whatIfHypotheticalAggregateWrap whatIfHypotheticalAggregateWrap--sellCards">
                    <div className="whatIfHypoAggregateDesktopTable">
                      <div className="profitabilityTableWrap">
                        <table className="profitabilityTable whatIfTable whatIfHypoAggDesktopTable whatIfHypoAggDesktopTable--sell">
                          <thead>
                            <tr>
                              <th className="whatIfHypoAggDesktopExpandCol" scope="col" aria-label="expand">
                                {' '}
                              </th>
                              <th scope="col">{t('portfolio.asset')}</th>
                              <th scope="col">{t('portfolio.quantity')}</th>
                              <th scope="col">{t('modals.historyTableSellPrice')}</th>
                              <th scope="col">{t('modals.historyTableSaleAmount')}</th>
                              <th scope="col">{t('modals.historyTableRealizedPl')}</th>
                              <th scope="col">{t('whatif.hypoAggregateSellLineCountLabel')}</th>
                              <th
                                className="whatIfHypoAggDesktopActionsCol"
                                scope="col"
                                aria-label={t('whatif.hypoAggActionsColumn')}
                              >
                                {' '}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {aggregatedHypotheticalSellSummary.map((row) => {
                              const aggKey = `${row.symbol}\0${row.currency}`;
                              const isOpen = expandedHypoSellKeys.has(aggKey);
                              const lineCount = sellRows.reduce(
                                (n, r) => n + (hypoSellAggregateKey(r) === aggKey ? 1 : 0),
                                0,
                              );
                              const plPos = row.totalRealizedPl >= 0;
                              return (
                                <Fragment key={aggKey}>
                                  <tr className="whatIfHypoAggParentRow">
                                    <td data-label="">
                                      <button
                                        type="button"
                                        className="headerIconBtn positionExpandBtn"
                                        onClick={() =>
                                          setExpandedHypoSellKeys((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(aggKey)) next.delete(aggKey);
                                            else next.add(aggKey);
                                            return next;
                                          })
                                        }
                                        disabled={lineCount === 0}
                                        aria-expanded={isOpen}
                                        aria-label={t('whatif.toggleHypotheticalSellLines', { symbol: row.symbol })}
                                        title={
                                          isOpen
                                            ? t('whatif.hideHypotheticalSellLines')
                                            : t('whatif.showHypotheticalSellLines')
                                        }
                                      >
                                        {isOpen ? '▾' : '▸'}
                                      </button>
                                    </td>
                                    <td data-label={t('portfolio.asset')}>{row.symbol}</td>
                                    <td data-label={t('portfolio.quantity')}>
                                      {hideValues ? '—' : formatQty(row.totalQty)}
                                    </td>
                                    <td data-label={t('modals.historyTableSellPrice')}>
                                      {hideValues ? '—' : formatCurrencyValue(row.avgSell, row.currency)}
                                    </td>
                                    <td data-label={t('modals.historyTableSaleAmount')}>
                                      {hideValues ? '—' : formatCurrencyValue(row.totalProceeds, row.currency)}
                                    </td>
                                    <td
                                      data-label={t('modals.historyTableRealizedPl')}
                                      className={plPos ? 'whatIfHypoAggPlPos' : 'whatIfHypoAggPlNeg'}
                                    >
                                      <div className="whatIfHypoAggPlCell">
                                        <span>
                                          {hideValues ? '—' : formatCurrencyValue(row.totalRealizedPl, row.currency)}
                                        </span>
                                        <span className="whatIfHypoAggPlPct">
                                          {hideValues ? '—' : formatPercent(row.realizedPct)}
                                        </span>
                                      </div>
                                    </td>
                                    <td data-label={t('whatif.hypoAggregateSellLineCountLabel')}>{lineCount}</td>
                                    <td
                                      className="whatIfHypoAggDesktopActionsCol"
                                      data-label={t('whatif.hypoAggActionsColumn')}
                                    >
                                      <div className="whatIfHypoAggActionsCell">
                                        <button
                                          type="button"
                                          className="headerIconBtn whatIfIconBtn whatIfHypoAggAddBtn"
                                          onClick={() => openHypoSellModalForAggregate(aggKey)}
                                          disabled={lineCount === 0 || !activeScenarioId || isBusy}
                                          aria-label={t('whatif.hypoAggQuickAddSellAria', { symbol: row.symbol })}
                                          title={t('whatif.hypoAggQuickAddSellAria', { symbol: row.symbol })}
                                        >
                                          +
                                        </button>
                                        <button
                                          type="button"
                                          className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                          onClick={() => batchRemoveHypotheticalSellsForAggregate(aggKey, row.symbol)}
                                          disabled={lineCount === 0 || isPersistingInputs}
                                          aria-label={t('whatif.batchDeleteHypotheticalSalesAria', { symbol: row.symbol })}
                                          title={t('whatif.batchDeleteHypotheticalSalesAria', { symbol: row.symbol })}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  {isOpen && lineCount > 0 && (
                                    <tr className="whatIfHypoAggNestedRow">
                                      <td colSpan={8}>
                                        <div className="whatIfHypoNestedTableWrap">
                                          <table className="whatIfHypoNestedLinesTable">
                                            <thead>
                                              <tr>
                                                <th scope="col">{t('whatif.simulatedSellLinesSection')}</th>
                                                <th scope="col">{t('modals.historyTableQty')}</th>
                                                <th scope="col">{t('modals.historyTableSellPrice')}</th>
                                                <th scope="col">{t('modals.historyTableCostPerUnit')}</th>
                                                <th scope="col">{t('modals.historyTableSaleAmount')}</th>
                                                <th scope="col">{t('modals.historyTableRealizedPl')}</th>
                                                <th scope="col">{t('modals.historyTableRealizedReturn')}</th>
                                                <th
                                                  className="whatIfHypoNestedLinesTableActionsCol"
                                                  scope="col"
                                                  aria-label={t('modals.remove')}
                                                >
                                                  {' '}
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {sellRows
                                                .map((r, index) => ({ r, index }))
                                                .filter(({ r }) => hypoSellAggregateKey(r) === aggKey)
                                                .map(({ r, index }, i) => {
                                                  const quoteCcy = hypotheticalBuyQuoteCurrency(r);
                                                  const metrics = hypotheticalSellMetricsByIndex[index];
                                                  const proceeds =
                                                    metrics?.proceeds ?? Math.max(0, num(r.qty) * num(r.sellPrice));
                                                  const costPu = metrics?.costPerUnit ?? 0;
                                                  const realizedPl = metrics?.realizedPl ?? 0;
                                                  const realizedPct = metrics?.realizedReturnPct ?? 0;
                                                  const lineNo = i + 1;
                                                  const linePlPos = realizedPl >= 0;
                                                  return (
                                                    <tr key={r.id || `hypo-sell-${aggKey}-${index}`}>
                                                      <td data-label={t('whatif.simulatedSellLinesSection')}>
                                                        {t('whatif.simulatedSellLineLabel', { n: lineNo })}
                                                      </td>
                                                      <td data-label={t('modals.historyTableQty')}>
                                                        {hideValues ? '—' : formatQty(r.qty)}
                                                      </td>
                                                      <td data-label={t('modals.historyTableSellPrice')}>
                                                        {hideValues
                                                          ? '—'
                                                          : formatCurrencyValue(r.sellPrice, quoteCcy)}
                                                      </td>
                                                      <td data-label={t('modals.historyTableCostPerUnit')}>
                                                        {hideValues ? '—' : formatCurrencyValue(costPu, quoteCcy)}
                                                      </td>
                                                      <td data-label={t('modals.historyTableSaleAmount')}>
                                                        {hideValues
                                                          ? '—'
                                                          : formatCurrencyValue(proceeds, quoteCcy)}
                                                      </td>
                                                      <td
                                                        data-label={t('modals.historyTableRealizedPl')}
                                                        className={linePlPos ? 'whatIfHypoAggPlPos' : 'whatIfHypoAggPlNeg'}
                                                      >
                                                        {hideValues ? '—' : formatCurrencyValue(realizedPl, quoteCcy)}
                                                      </td>
                                                      <td
                                                        data-label={t('modals.historyTableRealizedReturn')}
                                                        className={linePlPos ? 'whatIfHypoAggPlPos' : 'whatIfHypoAggPlNeg'}
                                                      >
                                                        {hideValues ? '—' : formatPercent(realizedPct)}
                                                      </td>
                                                      <td data-label={t('modals.remove')}>
                                                        <button
                                                          type="button"
                                                          className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                                          onClick={() => removeSellRow(index)}
                                                          aria-label={t('modals.remove')}
                                                          title={t('modals.remove')}
                                                        >
                                                          ✕
                                                        </button>
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                            {aggregatedHypotheticalSellSummary.length === 0 && (
                              <tr>
                                <td colSpan={8}>{t('whatif.hypotheticalSalesAggregateEmpty')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="whatIfHypoAggregateMobileCards">
                    <div className="positionClassCards whatIfHypoSellParentCards">
                      {aggregatedHypotheticalSellSummary.map((row) => {
                        const aggKey = `${row.symbol}\0${row.currency}`;
                        const isOpen = expandedHypoSellKeys.has(aggKey);
                        const lineCount = sellRows.reduce(
                          (n, r) => n + (hypoSellAggregateKey(r) === aggKey ? 1 : 0),
                          0,
                        );
                        const plPos = row.totalRealizedPl >= 0;
                        return (
                          <section
                            key={aggKey}
                            className="positionDetailCard whatIfHypoSellParentCard"
                          >
                            <header>
                              <div className="positionNameCol">
                                <div className="positionMobileTitleRow">
                                  <button
                                    type="button"
                                    className="headerIconBtn positionExpandBtn"
                                    onClick={() =>
                                      setExpandedHypoSellKeys((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(aggKey)) next.delete(aggKey);
                                        else next.add(aggKey);
                                        return next;
                                      })
                                    }
                                    disabled={lineCount === 0}
                                    aria-expanded={isOpen}
                                    aria-label={t('whatif.toggleHypotheticalSellLines', { symbol: row.symbol })}
                                    title={
                                      isOpen
                                        ? t('whatif.hideHypotheticalSellLines')
                                        : t('whatif.showHypotheticalSellLines')
                                    }
                                  >
                                    {isOpen ? '▾' : '▸'}
                                  </button>
                                  <h3>{row.symbol}</h3>
                                </div>
                                <span className="positionMarketMeta">
                                  {t('whatif.hypoAggregateSellMeta', { count: lineCount })}
                                </span>
                              </div>
                              <div
                                className={`positionPnlDock whatIfHypoAggregateDock whatIfHypoAggregateDock--sell${
                                  plPos ? ' pos' : ' neg'
                                }`}
                              >
                                <strong>
                                  {hideValues ? '—' : formatCurrencyValue(row.totalRealizedPl, row.currency)}
                                </strong>
                                <span>{hideValues ? '—' : formatPercent(row.realizedPct)}</span>
                              </div>
                            </header>
                            <div className="positionQuickGrid">
                              <div className="positionQuickItem">
                                <span>{t('portfolio.quantity')}</span>
                                <strong>{hideValues ? '—' : formatQty(row.totalQty)}</strong>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('modals.historyTableSellPrice')}</span>
                                <strong>
                                  {hideValues ? '—' : formatCurrencyValue(row.avgSell, row.currency)}
                                </strong>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('modals.historyTableSaleAmount')}</span>
                                <strong>
                                  {hideValues ? '—' : formatCurrencyValue(row.totalProceeds, row.currency)}
                                </strong>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('whatif.hypoAggregateSellLineCountLabel')}</span>
                                <strong>{lineCount}</strong>
                              </div>
                            </div>
                            <dl className="positionMetaList whatIfHypoParentMetaActions">
                              <div className="positionMetaRowWithActions whatIfHypoMetaRowActionsOnly">
                                <div className="positionCardActionIcons">
                                  <button
                                    type="button"
                                    className="headerIconBtn whatIfIconBtn whatIfHypoAggAddBtn"
                                    onClick={() => openHypoSellModalForAggregate(aggKey)}
                                    disabled={lineCount === 0 || !activeScenarioId || isBusy}
                                    aria-label={t('whatif.hypoAggQuickAddSellAria', { symbol: row.symbol })}
                                    title={t('whatif.hypoAggQuickAddSellAria', { symbol: row.symbol })}
                                  >
                                    +
                                  </button>
                                  <button
                                    type="button"
                                    className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                    onClick={() => batchRemoveHypotheticalSellsForAggregate(aggKey, row.symbol)}
                                    disabled={lineCount === 0 || isPersistingInputs}
                                    aria-label={t('whatif.batchDeleteHypotheticalSalesAria', { symbol: row.symbol })}
                                    title={t('whatif.batchDeleteHypotheticalSalesAria', { symbol: row.symbol })}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            </dl>
                            {isOpen && (
                              <div className="positionCardExpandedWrap">
                                <div className="positionTxPanel positionTxPanel--mobile whatIfHypoNestedPanel">
                                  <section className="positionTxSection positionTxSection--sold">
                                    <div className="positionTxSectionHeader">
                                      <strong>{t('whatif.simulatedSellLinesSection')}</strong>
                                    </div>
                                    <div className="positionTxCards">
                                      {sellRows
                                        .map((r, index) => ({ r, index }))
                                        .filter(({ r }) => hypoSellAggregateKey(r) === aggKey)
                                        .map(({ r, index }, i) => {
                                          const quoteCcy = hypotheticalBuyQuoteCurrency(r);
                                          const metrics = hypotheticalSellMetricsByIndex[index];
                                          const proceeds =
                                            metrics?.proceeds ?? Math.max(0, num(r.qty) * num(r.sellPrice));
                                          const costPu = metrics?.costPerUnit ?? 0;
                                          const realizedPl = metrics?.realizedPl ?? 0;
                                          const realizedPct = metrics?.realizedReturnPct ?? 0;
                                          const lineNo = i + 1;
                                          return (
                                            <div
                                              key={r.id || `hypo-sell-${aggKey}-${index}`}
                                              className="positionTxCard"
                                            >
                                              <div className="positionTxCardTitleRow">
                                                <strong>{t('whatif.simulatedSellLineLabel', { n: lineNo })}</strong>
                                                <button
                                                  type="button"
                                                  className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                                  onClick={() => removeSellRow(index)}
                                                  aria-label={t('modals.remove')}
                                                  title={t('modals.remove')}
                                                >
                                                  ✕
                                                </button>
                                              </div>
                                              <div className="positionTxCardGrid">
                                                <div>
                                                  <span>{t('modals.historyTableQty')}</span>
                                                  <strong>{hideValues ? '—' : formatQty(r.qty)}</strong>
                                                </div>
                                                <div>
                                                  <span>{t('modals.historyTableSellPrice')}</span>
                                                  <strong>
                                                    {hideValues
                                                      ? '—'
                                                      : formatCurrencyValue(r.sellPrice, quoteCcy)}
                                                  </strong>
                                                </div>
                                                <div>
                                                  <span>{t('modals.historyTableCostPerUnit')}</span>
                                                  <strong>
                                                    {hideValues
                                                      ? '—'
                                                      : formatCurrencyValue(costPu, quoteCcy)}
                                                  </strong>
                                                </div>
                                                <div>
                                                  <span>{t('modals.historyTableSaleAmount')}</span>
                                                  <strong>
                                                    {hideValues
                                                      ? '—'
                                                      : formatCurrencyValue(proceeds, quoteCcy)}
                                                  </strong>
                                                </div>
                                                <div>
                                                  <span>{t('modals.historyTableRealizedPl')}</span>
                                                  <strong className={realizedPl >= 0 ? 'pos' : 'neg'}>
                                                    {hideValues
                                                      ? '—'
                                                      : formatCurrencyValue(realizedPl, quoteCcy)}
                                                  </strong>
                                                </div>
                                                <div>
                                                  <span>{t('modals.historyTableRealizedReturn')}</span>
                                                  <strong className={realizedPl >= 0 ? 'pos' : 'neg'}>
                                                    {hideValues ? '—' : formatPercent(realizedPct)}
                                                  </strong>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </section>
                                </div>
                              </div>
                            )}
                          </section>
                        );
                      })}
                      {aggregatedHypotheticalSellSummary.length === 0 && (
                        <p className="positionTxEmpty whatIfHypoAggregateEmpty">{t('whatif.noHypotheticalSales')}</p>
                      )}
                    </div>
                    </div>
                      {aggregatedHypotheticalSellSummary.length > 0 &&
                        hypotheticalSellSubtotalsByCurrency.map((sub) => (
                          <div
                            key={`sell-agg-subtotal-${sub.currency}`}
                            className="whatIfHypoSubtotalStrip whatIfHypoSubtotalStrip--sell"
                          >
                            <span className="whatIfHypoSubtotalStripLabel">
                              {hypotheticalSellSubtotalsByCurrency.length > 1
                                ? `${t('whatif.hypotheticalAggregateSubtotal')} (${sub.currency})`
                                : t('whatif.hypotheticalAggregateSubtotal')}
                            </span>
                            <strong className="whatIfHypoSubtotalStripValue">
                              {hideValues ? '—' : formatCurrencyValue(sub.totalProceeds, sub.currency)}
                            </strong>
                          </div>
                        ))}
                  </div>
                </section>

                <section className="whatIfSection whatIfSection--targetPrice">
                  <header className="whatIfHypoSectionHead">
                    <div className="whatIfHypoSectionHeadRow">
                      <h2 className="whatIfHypoBadge whatIfHypoBadge--target">{t('whatif.featureATitle')}</h2>
                    </div>
                  </header>
                  <div className="whatIfHypotheticalAggregateWrap whatIfHypotheticalAggregateWrap--targetPriceCards">
                    <div className="whatIfTargetPriceDesktopTable profitabilityTableWrap">
                      <table className="profitabilityTable whatIfTable whatIfTableTarget">
                        <thead>
                          <tr>
                            <th>{t('portfolio.asset')}</th>
                            <th>{t('whatif.currentPrice')}</th>
                            <th>{t('whatif.targetDeltaVsCurrentPct')}</th>
                            <th>{t('whatif.targetPrice')}</th>
                            <th>{t('whatif.targetDeltaVsCurrentPct2')}</th>
                            <th>{t('whatif.targetPrice2')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultRows.map((row) => {
                            const targetRow = targetPrices.find(
                              (x) => String(x.symbol).toUpperCase() === String(row.symbol).toUpperCase(),
                            );
                            const targetCurrency = targetRow?.currency || row.currency || 'USD';
                            const symU = String(row.symbol || '').toUpperCase();
                            const rowTargetDirty = unsavedTargetSymbolSet.has(symU);
                            const targetPriceInputClass = `profitabilityInput${rowTargetDirty ? ' whatIfTargetInput--unsaved' : ''}`;
                            const rowInlineSaveActive = rowTargetDirty && !isPersistingInputs;
                            const pricePrefix = targetSimulationCurrencyPrefix(targetCurrency);
                            return (
                              <tr key={row.symbol}>
                                <td data-label={t('portfolio.asset')}>{row.symbol}</td>
                                <td data-label={t('whatif.currentPrice')}>
                                  {hideValues
                                    ? '—'
                                    : `${pricePrefix}${formatPriceNumber(row.baselinePrice, targetCurrency)}`}
                                </td>
                                <td data-label={t('whatif.targetDeltaVsCurrentPct')}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    className="profitabilityInput"
                                    value={targetPricePctBySymbol[row.symbol] ?? ''}
                                    onChange={(e) =>
                                      updateTargetPricePct(
                                        row.symbol,
                                        e.target.value,
                                        row.baselinePrice,
                                        targetCurrency,
                                      )
                                    }
                                    onKeyDown={handleTargetPriceFieldKeyDown}
                                    placeholder="0.0"
                                    disabled={num(row.baselinePrice) <= 0}
                                  />
                                </td>
                                <td data-label={t('whatif.targetPrice')}>
                                  <span className="rebalanceTargetWrap whatIfTargetPriceFieldRow">
                                    {!hideValues && (
                                      <span
                                        className="whatIfPricePrefix whatIfTargetPriceInputPrefix"
                                        aria-hidden="true"
                                      >
                                        {pricePrefix}
                                      </span>
                                    )}
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      className={targetPriceInputClass}
                                      value={targetRow?.targetPrice ?? ''}
                                      onChange={(e) => {
                                        const nextVal = e.target.value;
                                        updateTargetPrice(row.symbol, nextVal, targetCurrency);
                                        const baseline = num(row.baselinePrice);
                                        const nextNum = num(nextVal);
                                        setTargetPricePctBySymbol((prev) => ({
                                          ...prev,
                                          [row.symbol]:
                                            baseline > 0 && nextVal !== ''
                                              ? (((nextNum - baseline) / baseline) * 100).toFixed(2)
                                              : '',
                                        }));
                                      }}
                                      onKeyDown={handleTargetPriceFieldKeyDown}
                                    />
                                    <button
                                      type="button"
                                      className={`headerIconBtn whatIfIconBtn${rowInlineSaveActive ? ' whatIfTargetPriceSaveBtn--pending' : ''}`}
                                      disabled={!hasUnsavedTargetPrices || isPersistingInputs}
                                      aria-label={t('whatif.saveTargetPricesMobileAria')}
                                      title={t('whatif.saveTargetPricesMobileAria')}
                                      onClick={() => void saveTargetPricesNow()}
                                    >
                                      ✓
                                    </button>
                                  </span>
                                </td>
                                <td data-label={t('whatif.targetDeltaVsCurrentPct2')}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    className="profitabilityInput"
                                    value={targetPrice2PctBySymbol[row.symbol] ?? ''}
                                    onChange={(e) =>
                                      updateTargetPrice2Pct(
                                        row.symbol,
                                        e.target.value,
                                        row.baselinePrice,
                                        targetCurrency,
                                      )
                                    }
                                    onKeyDown={handleTargetPriceFieldKeyDown}
                                    placeholder="0.0"
                                    disabled={num(row.baselinePrice) <= 0}
                                  />
                                </td>
                                <td data-label={t('whatif.targetPrice2')}>
                                  <span className="rebalanceTargetWrap whatIfTargetPriceFieldRow">
                                    {!hideValues && (
                                      <span
                                        className="whatIfPricePrefix whatIfTargetPriceInputPrefix"
                                        aria-hidden="true"
                                      >
                                        {pricePrefix}
                                      </span>
                                    )}
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      className={targetPriceInputClass}
                                      value={targetRow?.targetPrice2 ?? ''}
                                      onChange={(e) => {
                                        const nextVal = e.target.value;
                                        updateTargetPrice2(row.symbol, nextVal, targetCurrency);
                                        const baseline = num(row.baselinePrice);
                                        const nextNum = num(nextVal);
                                        setTargetPrice2PctBySymbol((prev) => ({
                                          ...prev,
                                          [row.symbol]:
                                            baseline > 0 && nextVal !== ''
                                              ? (((nextNum - baseline) / baseline) * 100).toFixed(2)
                                              : '',
                                        }));
                                      }}
                                      onKeyDown={handleTargetPriceFieldKeyDown}
                                    />
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="whatIfTargetPriceMobileCards">
                    <div className="positionClassCards whatIfTargetPriceCards">
                      {resultRows.map((row) => {
                        const targetRow = targetPrices.find((x) => String(x.symbol).toUpperCase() === String(row.symbol).toUpperCase());
                        const targetCurrency = targetRow?.currency || row.currency || 'USD';
                        const symU = String(row.symbol || '').toUpperCase();
                        const rowTargetDirty = unsavedTargetSymbolSet.has(symU);
                        const targetPriceInputClass = `profitabilityInput${rowTargetDirty ? ' whatIfTargetInput--unsaved' : ''}`;
                        const rowInlineSaveActive = rowTargetDirty && !isPersistingInputs;
                        const pricePrefix = targetSimulationCurrencyPrefix(targetCurrency);
                        const targetPriceDisplay =
                          targetRow?.targetPrice !== '' && targetRow?.targetPrice != null
                            ? `${pricePrefix}${formatPriceNumber(num(targetRow.targetPrice), targetCurrency)}`
                            : null;
                        const targetPrice2Display =
                          targetRow?.targetPrice2 !== '' && targetRow?.targetPrice2 != null
                            ? `${pricePrefix}${formatPriceNumber(num(targetRow.targetPrice2), targetCurrency)}`
                            : null;
                        return (
                          <section
                            key={row.symbol}
                            className={`positionDetailCard whatIfTargetPriceCard${rowTargetDirty ? ' whatIfTargetPriceCard--unsaved' : ''}`}
                          >
                            <header>
                              <div className="positionNameCol">
                                <div className="positionMobileTitleRow">
                                  <h3>{row.symbol}</h3>
                                </div>
                                <span className="positionMarketMeta whatIfTargetPriceHeaderPrice">
                                  {hideValues
                                    ? '—'
                                    : `${pricePrefix}${formatPriceNumber(row.baselinePrice, targetCurrency)}`}
                                </span>
                              </div>
                              <div className="whatIfTargetPriceHeaderTargets">
                                <div className="positionPnlDock whatIfTargetPriceDock">
                                  <strong>
                                    {hideValues ? '—' : targetPriceDisplay ?? '—'}
                                  </strong>
                                  <span>{t('whatif.targetPrice')}</span>
                                </div>
                                <div className="positionPnlDock whatIfTargetPriceDock whatIfTargetPriceDock--secondary">
                                  <strong>
                                    {hideValues ? '—' : targetPrice2Display ?? '—'}
                                  </strong>
                                  <span>{t('whatif.targetPrice2')}</span>
                                </div>
                              </div>
                            </header>
                            <div className="positionQuickGrid whatIfTargetPriceQuickGrid">
                              <div className="positionQuickItem">
                                <span>{t('whatif.targetDeltaVsCurrentPct')}</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  className="profitabilityInput whatIfTargetPricePctInput"
                                  value={targetPricePctBySymbol[row.symbol] ?? ''}
                                  onChange={(e) =>
                                    updateTargetPricePct(
                                      row.symbol,
                                      e.target.value,
                                      row.baselinePrice,
                                      targetCurrency,
                                    )
                                  }
                                  onKeyDown={handleTargetPriceFieldKeyDown}
                                  placeholder="0.0"
                                  disabled={num(row.baselinePrice) <= 0}
                                />
                              </div>
                              <div className="positionQuickItem whatIfTargetPriceTargetBlock">
                                <span>{t('whatif.targetPrice')}</span>
                                <span className="rebalanceTargetWrap whatIfTargetPriceFieldRow">
                                  {!hideValues && (
                                    <span
                                      className="whatIfPricePrefix whatIfTargetPriceInputPrefix"
                                      aria-hidden="true"
                                    >
                                      {pricePrefix}
                                    </span>
                                  )}
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    className={targetPriceInputClass}
                                    value={targetRow?.targetPrice ?? ''}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      updateTargetPrice(row.symbol, nextVal, targetCurrency);
                                      const baseline = num(row.baselinePrice);
                                      const nextNum = num(nextVal);
                                      setTargetPricePctBySymbol((prev) => ({
                                        ...prev,
                                        [row.symbol]:
                                          baseline > 0 && nextVal !== ''
                                            ? (((nextNum - baseline) / baseline) * 100).toFixed(2)
                                            : '',
                                      }));
                                    }}
                                    onKeyDown={handleTargetPriceFieldKeyDown}
                                  />
                                </span>
                              </div>
                              <div className="positionQuickItem">
                                <span>{t('whatif.targetDeltaVsCurrentPct2')}</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  className="profitabilityInput whatIfTargetPricePctInput"
                                  value={targetPrice2PctBySymbol[row.symbol] ?? ''}
                                  onChange={(e) =>
                                    updateTargetPrice2Pct(
                                      row.symbol,
                                      e.target.value,
                                      row.baselinePrice,
                                      targetCurrency,
                                    )
                                  }
                                  onKeyDown={handleTargetPriceFieldKeyDown}
                                  placeholder="0.0"
                                  disabled={num(row.baselinePrice) <= 0}
                                />
                              </div>
                              <div className="positionQuickItem whatIfTargetPriceTargetBlock">
                                <span>{t('whatif.targetPrice2')}</span>
                                <span className="rebalanceTargetWrap whatIfTargetPriceFieldRow">
                                  {!hideValues && (
                                    <span
                                      className="whatIfPricePrefix whatIfTargetPriceInputPrefix"
                                      aria-hidden="true"
                                    >
                                      {pricePrefix}
                                    </span>
                                  )}
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    className={targetPriceInputClass}
                                    value={targetRow?.targetPrice2 ?? ''}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      updateTargetPrice2(row.symbol, nextVal, targetCurrency);
                                      const baseline = num(row.baselinePrice);
                                      const nextNum = num(nextVal);
                                      setTargetPrice2PctBySymbol((prev) => ({
                                        ...prev,
                                        [row.symbol]:
                                          baseline > 0 && nextVal !== ''
                                            ? (((nextNum - baseline) / baseline) * 100).toFixed(2)
                                            : '',
                                      }));
                                    }}
                                    onKeyDown={handleTargetPriceFieldKeyDown}
                                  />
                                </span>
                              </div>
                            </div>
                            <div className="whatIfTargetPriceMobileSaveRow">
                              <button
                                type="button"
                                className={`headerIconBtn whatIfIconBtn whatIfTargetPriceMobileSaveBtn${rowInlineSaveActive ? ' whatIfTargetPriceSaveBtn--pending' : ''}`}
                                disabled={!hasUnsavedTargetPrices || isPersistingInputs}
                                aria-label={t('whatif.saveTargetPricesMobileAria')}
                                title={t('whatif.saveTargetPricesMobileAria')}
                                onClick={() => void saveTargetPricesNow()}
                              >
                                ✓
                              </button>
                            </div>
                          </section>
                        );
                      })}
                    </div>
                    </div>
                  </div>
                  <div className={`whatIfTargetToolbar${targetSaveUiActive ? ' whatIfTargetToolbar--unsaved' : ''}`}>
                    <div className="whatIfTargetToolbarActions">
                      {hasTargetPrice2ToClear && (
                        <button
                          type="button"
                          className="whatIfClearTarget2Btn"
                          disabled={isPersistingInputs}
                          aria-label={t('whatif.clearTargetPrice2Aria')}
                          title={t('whatif.clearTargetPrice2Aria')}
                          onClick={() => void clearAllTargetPrice2AndSave()}
                        >
                          {t('whatif.clearTargetPrice2')}
                        </button>
                      )}
                      {targetSaveUiActive && (
                        <button
                          type="button"
                          className="whatIfTargetCancelBtn"
                          disabled={isPersistingInputs}
                          onClick={() => cancelTargetPriceEdits()}
                        >
                          {t('modals.cancel')}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`whatIfStickySaveBtn${targetSaveUiActive ? ' whatIfStickySaveBtn--unsaved' : ''}`}
                        disabled={!hasUnsavedTargetPrices || isPersistingInputs}
                        onClick={() => void saveTargetPricesNow()}
                      >
                        {t('whatif.applyTargetPrices')}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="whatIfSection">
                  <h2>{t('whatif.resultsTitle')}</h2>
                  {hypoPurchaseFunding && (
                    <div
                      className={`whatIfHypoFundingCallout${hypoPurchaseFunding.covered ? ' whatIfHypoFundingCallout--covered' : ' whatIfHypoFundingCallout--short'}`}
                    >
                      <h3 className="whatIfHypoFundingTitle">{t('whatif.hypoFundingTitle')}</h3>
                      <div className="whatIfHypoFundingTableWrap">
                        <table className="whatIfHypoFundingTable">
                          <thead>
                            <tr>
                              <th scope="col">{t('whatif.hypoFundingColQuote')}</th>
                              <th scope="col">{t('whatif.hypoFundingCash')}</th>
                              <th scope="col">{t('whatif.hypoFundingProceeds')}</th>
                              <th scope="col">{t('whatif.hypoFundingRequired')}</th>
                              <th scope="col">{t('whatif.hypoFundingAvailable')}</th>
                              <th scope="col">{t('whatif.hypoFundingBalance')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hypoPurchaseFunding.rows.map((r) => (
                              <tr key={r.bucket}>
                                <td data-label={t('whatif.hypoFundingColQuote')}>{r.bucket}</td>
                                <td data-label={t('whatif.hypoFundingCash')}>
                                  {hideValues ? '—' : formatCurrencyValue(r.cash, r.bucket)}
                                </td>
                                <td data-label={t('whatif.hypoFundingProceeds')}>
                                  {hideValues ? '—' : formatCurrencyValue(r.proceeds, r.bucket)}
                                </td>
                                <td data-label={t('whatif.hypoFundingRequired')}>
                                  {hideValues ? '—' : formatCurrencyValue(r.required, r.bucket)}
                                </td>
                                <td data-label={t('whatif.hypoFundingAvailable')}>
                                  {hideValues ? '—' : formatCurrencyValue(r.available, r.bucket)}
                                </td>
                                <td
                                  data-label={t('whatif.hypoFundingBalance')}
                                  className={
                                    r.required > 1e-9
                                      ? r.balance >= -1e-6
                                        ? 'whatIfHypoFundingBalance--ok'
                                        : 'whatIfHypoFundingBalance--short'
                                      : ''
                                  }
                                >
                                  {hideValues
                                    ? '—'
                                    : r.required > 1e-9
                                      ? formatCurrencyValue(r.balance, r.bucket)
                                      : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="whatIfHypoFundingVerdict" role="status">
                        {hypoPurchaseFunding.covered
                          ? t('whatif.hypoFundingCovered')
                          : t('whatif.hypoFundingShortLead')}
                        {!hypoPurchaseFunding.covered && !hideValues && hypoPurchaseFunding.shortBuckets.length > 0 ? (
                          <span className="whatIfHypoFundingShortList">
                            {' '}
                            {hypoPurchaseFunding.shortBuckets.map(({ bucket, shortfall }, i) => (
                              <span key={bucket}>
                                {i > 0 ? t('whatif.hypoFundingShortSep') : ''}
                                {t('whatif.hypoFundingShortPart', {
                                  amount: formatCurrencyValue(shortfall, bucket),
                                })}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  )}
                  <div className="whatIfResultsKpiStack">
                  <div className="whatIfResultsNetWorthBlock">
                    <label className="whatIfToggleRow">
                      <input
                        type="checkbox"
                        className="whatIfToggleInput"
                        checked={adjustScenarioCashForHypotheticals}
                        onChange={(e) => setAdjustScenarioCashForHypotheticals(e.target.checked)}
                      />
                      <span className="whatIfToggleSwitch" aria-hidden="true" />
                      <span className="whatIfToggleText">{t('whatif.netWorthAdjustHypotheticalCash')}</span>
                    </label>
                    <div className="profitabilitySellDownResult rebalanceKpiRow">
                      <div className="profitabilityCard">
                        <span className="profitabilityCardLabel">{t('whatif.baselineNetWorth')}</span>
                        <span className="profitabilityCardValue">
                          {hideValues ? '—' : formatCurrencyValue(baselineNetWorth, baseCurrency)}
                        </span>
                      </div>
                      {hasSecondaryTargetPrices ? (
                        <>
                          <div className="profitabilityCard">
                            <span className="profitabilityCardLabel">{t('whatif.scenarioNetWorthTarget1')}</span>
                            <span className="profitabilityCardValue">
                              {hideValues ? '—' : formatCurrencyValue(scenarioNetWorth, baseCurrency)}
                            </span>
                          </div>
                          <div className="profitabilityCard">
                            <span className="profitabilityCardLabel">{t('whatif.netWorthDeltaTarget1')}</span>
                            <span className={`profitabilityCardValue ${netWorthDelta >= 0 ? 'pos' : 'neg'}`}>
                              {hideValues ? '—' : formatCurrencyValue(netWorthDelta, baseCurrency)}
                            </span>
                            <small className={`profitabilityCardSub ${netWorthDeltaPct >= 0 ? 'pos' : 'neg'}`}>
                              {hideValues ? '—' : formatPercent(netWorthDeltaPct)}
                            </small>
                          </div>
                          <div className="profitabilityCard">
                            <span className="profitabilityCardLabel">{t('whatif.scenarioNetWorthTarget2')}</span>
                            <span className="profitabilityCardValue">
                              {hideValues ? '—' : formatCurrencyValue(scenarioNetWorth2, baseCurrency)}
                            </span>
                          </div>
                          <div className="profitabilityCard">
                            <span className="profitabilityCardLabel">{t('whatif.netWorthDeltaTarget2')}</span>
                            <span className={`profitabilityCardValue ${netWorthDelta2 >= 0 ? 'pos' : 'neg'}`}>
                              {hideValues ? '—' : formatCurrencyValue(netWorthDelta2, baseCurrency)}
                            </span>
                            <small className={`profitabilityCardSub ${netWorthDeltaPct2 >= 0 ? 'pos' : 'neg'}`}>
                              {hideValues ? '—' : formatPercent(netWorthDeltaPct2)}
                            </small>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="profitabilityCard">
                            <span className="profitabilityCardLabel">{t('whatif.scenarioNetWorth')}</span>
                            <span className="profitabilityCardValue">
                              {hideValues ? '—' : formatCurrencyValue(scenarioNetWorth, baseCurrency)}
                            </span>
                          </div>
                          <div className="profitabilityCard">
                            <span className="profitabilityCardLabel">{t('whatif.netWorthDelta')}</span>
                            <span className={`profitabilityCardValue ${netWorthDelta >= 0 ? 'pos' : 'neg'}`}>
                              {hideValues ? '—' : formatCurrencyValue(netWorthDelta, baseCurrency)}
                            </span>
                            <small className={`profitabilityCardSub ${netWorthDeltaPct >= 0 ? 'pos' : 'neg'}`}>
                              {hideValues ? '—' : formatPercent(netWorthDeltaPct)}
                            </small>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="profitabilitySellDownResult rebalanceKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineUnrealizedPl')}</span>
                      <span className={`profitabilityCardValue ${baselineUnrealized >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatMoney(baselineUnrealized)}
                      </span>
                      <small className={`profitabilityCardSub ${baselineUnrealized >= 0 ? 'pos' : 'neg'}`}>
                        {hideValues ? '—' : formatPercent(baselineUnrealizedPct)}
                      </small>
                    </div>
                    {hasSecondaryTargetPrices ? (
                      <>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioUnrealizedPlTarget1')}</span>
                          <span className={`profitabilityCardValue ${scenarioUnrealized >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(scenarioUnrealized)}
                          </span>
                          <small className={`profitabilityCardSub ${scenarioUnrealized >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatPercent(scenarioUnrealizedPct)}
                          </small>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.plDeltaTarget1')}</span>
                          <span className={`profitabilityCardValue ${unrealizedDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(unrealizedDelta)}
                          </span>
                          <small className={`profitabilityCardSub ${unrealizedDeltaPct >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatPercent(unrealizedDeltaPct)}
                          </small>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioUnrealizedPlTarget2')}</span>
                          <span className={`profitabilityCardValue ${scenarioUnrealized2 >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(scenarioUnrealized2)}
                          </span>
                          <small className={`profitabilityCardSub ${scenarioUnrealized2 >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatPercent(scenarioUnrealizedPct2)}
                          </small>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.plDeltaTarget2')}</span>
                          <span className={`profitabilityCardValue ${unrealizedDelta2 >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(unrealizedDelta2)}
                          </span>
                          <small className={`profitabilityCardSub ${unrealizedDeltaPct2 >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatPercent(unrealizedDeltaPct2)}
                          </small>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioUnrealizedPl')}</span>
                          <span className={`profitabilityCardValue ${scenarioUnrealized >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(scenarioUnrealized)}
                          </span>
                          <small className={`profitabilityCardSub ${scenarioUnrealized >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatPercent(scenarioUnrealizedPct)}
                          </small>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.plDelta')}</span>
                          <span className={`profitabilityCardValue ${unrealizedDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(unrealizedDelta)}
                          </span>
                          <small className={`profitabilityCardSub ${unrealizedDeltaPct >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatPercent(unrealizedDeltaPct)}
                          </small>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="profitabilitySellDownResult rebalanceKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineValue')}</span>
                      <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(baselineTotal)}</span>
                    </div>
                    {hasSecondaryTargetPrices ? (
                      <>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioValueTarget1')}</span>
                          <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioTotal)}</span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.portfolioValueDeltaTarget1')}</span>
                          <span className={`profitabilityCardValue ${portfolioValueDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(portfolioValueDelta)}
                          </span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioValueTarget2')}</span>
                          <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioTotal2)}</span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.portfolioValueDeltaTarget2')}</span>
                          <span className={`profitabilityCardValue ${portfolioValueDelta2 >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(portfolioValueDelta2)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioValue')}</span>
                          <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioTotal)}</span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.portfolioValueDelta')}</span>
                          <span className={`profitabilityCardValue ${portfolioValueDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(portfolioValueDelta)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="profitabilitySellDownResult rebalanceKpiRow">
                    <div className="profitabilityCard">
                      <span className="profitabilityCardLabel">{t('whatif.baselineCostBasis')}</span>
                      <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(baselineCostBasis)}</span>
                    </div>
                    {hasSecondaryTargetPrices ? (
                      <>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioCostBasisTarget1')}</span>
                          <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioCostBasis)}</span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.costBasisDeltaTarget1')}</span>
                          <span className={`profitabilityCardValue ${costBasisDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(costBasisDelta)}
                          </span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioCostBasisTarget2')}</span>
                          <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioCostBasis)}</span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.costBasisDeltaTarget2')}</span>
                          <span className={`profitabilityCardValue ${costBasisDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(costBasisDelta)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.scenarioCostBasis')}</span>
                          <span className="profitabilityCardValue">{hideValues ? '—' : formatMoney(scenarioCostBasis)}</span>
                        </div>
                        <div className="profitabilityCard">
                          <span className="profitabilityCardLabel">{t('whatif.costBasisDelta')}</span>
                          <span className={`profitabilityCardValue ${costBasisDelta >= 0 ? 'pos' : 'neg'}`}>
                            {hideValues ? '—' : formatMoney(costBasisDelta)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  </div>

                  <div className="whatIfWeightCharts">
                    {weightChartRows.length === 0 ? (
                      <p className="whatIfWeightChartsEmpty">{t('whatif.weightChartsNoData')}</p>
                    ) : (
                      <div className="whatIfWeightChartCard">
                        <h3 className="whatIfWeightChartTitle">{t('whatif.weightChartCombinedTitle')}</h3>
                        <div className="whatIfWeightChartArea whatIfWeightChartArea--vertical">
                          <ResponsiveContainer width="100%" height={340}>
                            <BarChart
                              data={weightChartRows}
                              margin={{ top: 28, right: 8, left: 0, bottom: 4 }}
                              barCategoryGap="14%"
                              barGap={4}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                              <XAxis
                                dataKey="name"
                                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                                tickLine={false}
                                axisLine={{ stroke: '#475569' }}
                                interval={0}
                                angle={-28}
                                textAnchor="end"
                                height={48}
                              />
                              <YAxis
                                type="number"
                                domain={[
                                  0,
                                  (dataMax) =>
                                    Number.isFinite(dataMax) ? Math.max(100, dataMax * 1.08) : 100,
                                ]}
                                tickFormatter={(v) => `${v}%`}
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                width={44}
                              />
                              <Tooltip
                                cursor={{ fill: 'rgba(148, 163, 184, 0.07)' }}
                                content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const p = payload[0].payload;
                                  return (
                                    <div className="whatIfScenarioWeightTooltip">
                                      <p className="whatIfScenarioWeightTooltipName">{p.name}</p>
                                      <p className="whatIfScenarioWeightTooltipRow">
                                        <span>{t('whatif.weightTooltipBaseline')}</span>
                                        <span>{hideValues ? '—' : formatPercent(p.baselineWeight)}</span>
                                      </p>
                                      <p className="whatIfScenarioWeightTooltipRow">
                                        <span>
                                          {t(
                                            hasSecondaryTargetPrices
                                              ? 'whatif.weightTooltipScenarioTarget1'
                                              : 'whatif.weightTooltipScenario',
                                          )}
                                        </span>
                                        <span>{hideValues ? '—' : formatPercent(p.scenarioWeight)}</span>
                                      </p>
                                      <p className="whatIfScenarioWeightTooltipRow">
                                        <span>
                                          {t(
                                            hasSecondaryTargetPrices
                                              ? 'whatif.weightDeltaVsBaselineTarget1'
                                              : 'whatif.weightDeltaVsBaseline',
                                          )}
                                        </span>
                                        <span
                                          className={
                                            hideValues
                                              ? undefined
                                              : p.deltaVsBaseline >= 0
                                                ? 'pos'
                                                : 'neg'
                                          }
                                        >
                                          {hideValues ? '—' : formatPercent(p.deltaVsBaseline)}
                                        </span>
                                      </p>
                                      {hasSecondaryTargetPrices ? (
                                        <>
                                          <p className="whatIfScenarioWeightTooltipRow">
                                            <span>{t('whatif.weightTooltipScenarioTarget2')}</span>
                                            <span>{hideValues ? '—' : formatPercent(p.scenarioWeight2)}</span>
                                          </p>
                                          <p className="whatIfScenarioWeightTooltipRow">
                                            <span>{t('whatif.weightDeltaVsBaselineTarget2')}</span>
                                            <span
                                              className={
                                                hideValues
                                                  ? undefined
                                                  : p.delta2VsBaseline >= 0
                                                    ? 'pos'
                                                    : 'neg'
                                              }
                                            >
                                              {hideValues ? '—' : formatPercent(p.delta2VsBaseline)}
                                            </span>
                                          </p>
                                        </>
                                      ) : null}
                                      <p className="whatIfScenarioWeightTooltipRow whatIfScenarioWeightTooltipRow--divider">
                                        <span>{t('whatif.weightTooltipScenarioQty')}</span>
                                        <span>{hideValues ? '—' : formatQty(p.scenarioQty)}</span>
                                      </p>
                                      <p className="whatIfScenarioWeightTooltipRow">
                                        <span>
                                          {t(
                                            hasSecondaryTargetPrices
                                              ? 'whatif.weightTooltipScenarioTargetPrice1'
                                              : 'whatif.weightTooltipScenarioTargetPrice',
                                          )}
                                        </span>
                                        <span>
                                          {hideValues
                                            ? '—'
                                            : `${formatPriceNumber(p.scenarioPrice, p.currency)} ${p.currency}`}
                                        </span>
                                      </p>
                                      <p className="whatIfScenarioWeightTooltipRow">
                                        <span>
                                          {t(
                                            hasSecondaryTargetPrices
                                              ? 'whatif.weightTooltipScenarioMarketValue1'
                                              : 'whatif.weightTooltipScenarioMarketValue',
                                          )}
                                        </span>
                                        <span>
                                          {hideValues ? '—' : formatCurrencyValue(p.scenarioValue, p.currency)}
                                        </span>
                                      </p>
                                      {hasSecondaryTargetPrices ? (
                                        <>
                                          <p className="whatIfScenarioWeightTooltipRow">
                                            <span>{t('whatif.weightTooltipScenarioTargetPrice2')}</span>
                                            <span>
                                              {hideValues
                                                ? '—'
                                                : `${formatPriceNumber(p.scenarioPrice2, p.currency)} ${p.currency}`}
                                            </span>
                                          </p>
                                          <p className="whatIfScenarioWeightTooltipRow">
                                            <span>{t('whatif.weightTooltipScenarioMarketValue2')}</span>
                                            <span>
                                              {hideValues ? '—' : formatCurrencyValue(p.scenarioValue2, p.currency)}
                                            </span>
                                          </p>
                                        </>
                                      ) : null}
                                    </div>
                                  );
                                }}
                              />
                              <Legend
                                wrapperStyle={{ paddingTop: 6, color: 'var(--text-dim)', fontSize: 12 }}
                                formatter={(value) => value}
                                iconType="square"
                                iconSize={10}
                              />
                              <Bar
                                name={t('whatif.weightLegendBaseline')}
                                dataKey="baselineWeight"
                                fill="rgba(56, 189, 248, 0.35)"
                                radius={[4, 4, 0, 0]}
                                isAnimationActive={false}
                                activeBar={<ActiveWhatIfWeightBar />}
                              >
                                <LabelList
                                  dataKey="baselineWeight"
                                  position="top"
                                  fill="#cbd5e1"
                                  fontSize={10}
                                  formatter={formatWeightBarLabel}
                                />
                              </Bar>
                              <Bar
                                name={
                                  hasSecondaryTargetPrices
                                    ? t('whatif.weightLegendScenarioTarget1')
                                    : t('whatif.weightLegendScenario')
                                }
                                dataKey="scenarioWeight"
                                fill="rgba(94, 234, 212, 0.52)"
                                radius={[4, 4, 0, 0]}
                                isAnimationActive={false}
                                activeBar={<ActiveWhatIfWeightBar />}
                              >
                                <LabelList
                                  dataKey="scenarioWeight"
                                  position="top"
                                  fill="#e0f2fe"
                                  fontSize={10}
                                  formatter={formatWeightBarLabel}
                                />
                              </Bar>
                              {hasSecondaryTargetPrices ? (
                                <Bar
                                  name={t('whatif.weightLegendScenarioTarget2')}
                                  dataKey="scenarioWeight2"
                                  fill="rgba(167, 139, 250, 0.55)"
                                  radius={[4, 4, 0, 0]}
                                  isAnimationActive={false}
                                  activeBar={<ActiveWhatIfWeightBar />}
                                >
                                  <LabelList
                                    dataKey="scenarioWeight2"
                                    position="top"
                                    fill="#e9d5ff"
                                    fontSize={10}
                                    formatter={formatWeightBarLabel}
                                  />
                                </Bar>
                              ) : null}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {hypoBuyStockModalOpen && (
                  <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="hypo-buy-stock-modal-title"
                  >
                    <section className="modalCard whatIfHypoBuyModalCard whatIfHypoBuyModalCard--stock">
                      <header className="modalHeader">
                        <h2 id="hypo-buy-stock-modal-title">{t('modals.addStockPosition')}</h2>
                        <button
                          type="button"
                          className="modalCloseBtn"
                          aria-label={t('modals.close')}
                          onClick={() => setHypoBuyStockModalOpen(false)}
                        >
                          ✕
                        </button>
                      </header>
                      <div className="modalBody">
                        <label className="modalLabel">
                          {t('modals.asset')}
                          <input
                            className="modalInput"
                            value={stockForm.query}
                            onChange={(e) => {
                              const nextQuery = e.target.value;
                              setStockForm((prev) => ({ ...prev, query: nextQuery, selectedSymbol: '' }));
                            }}
                            placeholder={t('modals.placeholderStock')}
                          />
                        </label>
                        {!stockForm.selectedSymbol && normalizeText(stockForm.query) && (
                          <div className="modalProductList">
                            {isLoadingStockSymbols && <p className="modalHint">{t('modals.loadingSymbols')}</p>}
                            {!isLoadingStockSymbols && stockSymbols.length === 0 && (
                              <p className="modalHint">{t('modals.noMatchingStock')}</p>
                            )}
                            {!isLoadingStockSymbols && stockSymbols.length > 0 && (
                              <ul>
                                {stockSymbolsSorted.map((item) => (
                                  <li key={item.symbol}>
                                    <button
                                      type="button"
                                      className="modalProductItem"
                                      onClick={() =>
                                        setStockForm((prev) => ({
                                          ...prev,
                                          selectedSymbol: item.symbol,
                                          query: item.symbol,
                                        }))
                                      }
                                    >
                                      <span className="modalProductMain">{item.symbol}</span>
                                      {item.securityName && (
                                        <span className="modalProductSub">{item.securityName}</span>
                                      )}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        <div className="modalGrid">
                          <label className="modalLabel">
                            {t('modals.quantity')}
                            <input
                              ref={stockHypotheticalQtyRef}
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={stockForm.qty}
                              disabled={!stockForm.selectedSymbol}
                              aria-disabled={!stockForm.selectedSymbol}
                              onChange={(e) =>
                                setStockForm((prev) => ({
                                  ...prev,
                                  qty: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                                }))
                              }
                            />
                          </label>
                          <label className="modalLabel">
                            {t('modals.avgCostPerUnit')}
                            <input
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={stockForm.buyPrice}
                              disabled={!stockForm.selectedSymbol}
                              aria-disabled={!stockForm.selectedSymbol}
                              onChange={(e) =>
                                setStockForm((prev) => ({
                                  ...prev,
                                  buyPrice: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                                }))
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <footer className="modalFooter whatIfHypoBuyModalFooter">
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => setHypoBuyStockModalOpen(false)}
                        >
                          {t('modals.cancel')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => {
                            resetStockHypotheticalForm();
                          }}
                        >
                          {t('whatif.hypoBuyModalClearForm')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn"
                          onClick={() => {
                            if (addStockHypotheticalBuyToList()) setHypoBuyStockModalOpen(false);
                          }}
                        >
                          {t('whatif.addHypotheticalBuyToList')}
                        </button>
                      </footer>
                      <p className="modalDisclaimer">{t('modals.disclaimerStock')}</p>
                    </section>
                  </div>
                )}

                {hypoBuyCryptoModalOpen && (
                  <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="hypo-buy-crypto-modal-title"
                  >
                    <section className="modalCard whatIfHypoBuyModalCard whatIfHypoBuyModalCard--crypto">
                      <header className="modalHeader">
                        <h2 id="hypo-buy-crypto-modal-title">{t('modals.addCryptoPosition')}</h2>
                        <button
                          type="button"
                          className="modalCloseBtn"
                          aria-label={t('modals.close')}
                          onClick={() => setHypoBuyCryptoModalOpen(false)}
                        >
                          ✕
                        </button>
                      </header>
                      <div className="modalBody">
                        <label className="modalLabel">
                          {t('modals.asset')}
                          <input
                            className="modalInput"
                            value={cryptoForm.query}
                            onChange={(e) => {
                              const nextQuery = e.target.value;
                              setCryptoForm((prev) => ({ ...prev, query: nextQuery, selectedProductId: '' }));
                            }}
                            placeholder={t('modals.placeholderCrypto')}
                          />
                        </label>
                        {!cryptoForm.selectedProductId && normalizeText(cryptoForm.query) && (
                          <div className="modalProductList">
                            {isLoadingCryptoProducts && <p className="modalHint">{t('modals.loadingProducts')}</p>}
                            {!isLoadingCryptoProducts && cryptoProducts.length === 0 && (
                              <p className="modalHint">{t('modals.noMatchingCrypto')}</p>
                            )}
                            {!isLoadingCryptoProducts && cryptoProducts.length > 0 && (
                              <ul>
                                {cryptoProducts.map((item) => (
                                  <li key={item.productId}>
                                    <button
                                      type="button"
                                      className="modalProductItem"
                                      onClick={() =>
                                        setCryptoForm((prev) => ({
                                          ...prev,
                                          selectedProductId: item.productId,
                                          query: item.productId,
                                        }))
                                      }
                                    >
                                      <span className="modalProductMain">
                                        {item.baseCurrency}/{item.quoteCurrency}
                                      </span>
                                      <span className="modalProductSub">{item.productId}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        <div className="modalGrid">
                          <label className="modalLabel">
                            {t('modals.quantity')}
                            <input
                              ref={cryptoHypotheticalQtyRef}
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={cryptoForm.qty}
                              disabled={!cryptoForm.selectedProductId}
                              aria-disabled={!cryptoForm.selectedProductId}
                              onChange={(e) =>
                                setCryptoForm((prev) => ({
                                  ...prev,
                                  qty: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                                }))
                              }
                            />
                          </label>
                          <label className="modalLabel">
                            {t('modals.avgCostPerUnit')}
                            <input
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={cryptoForm.buyPrice}
                              disabled={!cryptoForm.selectedProductId}
                              aria-disabled={!cryptoForm.selectedProductId}
                              onChange={(e) =>
                                setCryptoForm((prev) => ({
                                  ...prev,
                                  buyPrice: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                                }))
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <footer className="modalFooter whatIfHypoBuyModalFooter">
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => setHypoBuyCryptoModalOpen(false)}
                        >
                          {t('modals.cancel')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => {
                            resetCryptoHypotheticalForm();
                          }}
                        >
                          {t('whatif.hypoBuyModalClearForm')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn"
                          onClick={() => {
                            if (addCryptoHypotheticalBuyToList()) setHypoBuyCryptoModalOpen(false);
                          }}
                        >
                          {t('whatif.addHypotheticalBuyToList')}
                        </button>
                      </footer>
                      <p className="modalDisclaimer">{t('modals.disclaimerCrypto')}</p>
                    </section>
                  </div>
                )}

                {hypoBuyCsvModalOpen && (
                  <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="hypo-buy-csv-modal-title"
                  >
                    <section className="modalCard modalCard--wide whatIfHypoBuyModalCard whatIfHypoBuyModalCard--csv">
                      <header className="modalHeader">
                        <h2 id="hypo-buy-csv-modal-title">{t('whatif.hypoBuyCsvTitle')}</h2>
                        <button
                          type="button"
                          className="modalCloseBtn"
                          aria-label={t('modals.close')}
                          onClick={() => setHypoBuyCsvModalOpen(false)}
                        >
                          ✕
                        </button>
                      </header>
                      <div className="modalBody">
                        <p className="whatIfCsvHelp">{t('whatif.hypoBuyCsvHelp')}</p>
                        <label className="modalLabel">
                          {t('whatif.hypoBuyCsvLabel')}
                          <textarea
                            className="whatIfCsvTextarea whatIfHypoBuyCsvTextarea"
                            value={hypoBuyCsvText}
                            onChange={(e) => setHypoBuyCsvText(e.target.value)}
                            placeholder={t('whatif.hypoBuyCsvPlaceholder')}
                            spellCheck={false}
                            rows={8}
                            disabled={isBusy || isPersistingInputs}
                          />
                        </label>
                      </div>
                      <footer className="modalFooter whatIfHypoBuyModalFooter">
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => setHypoBuyCsvModalOpen(false)}
                        >
                          {t('modals.cancel')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => setHypoBuyCsvText('')}
                          disabled={isBusy || isPersistingInputs || !hypoBuyCsvText.trim()}
                        >
                          {t('whatif.hypoBuyCsvClear')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn"
                          onClick={() => {
                            if (importHypotheticalBuysFromCsv()) setHypoBuyCsvModalOpen(false);
                          }}
                          disabled={
                            isBusy ||
                            isPersistingInputs ||
                            !String(hypoBuyCsvText || '').trim() ||
                            !activeScenarioId
                          }
                        >
                          {t('whatif.hypoBuyCsvImport')}
                        </button>
                      </footer>
                    </section>
                  </div>
                )}

                {hypoSellStockModalOpen && (
                  <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="hypo-sell-stock-modal-title"
                  >
                    <section className="modalCard whatIfHypoSellModalCard">
                      <header className="modalHeader">
                        <h2 id="hypo-sell-stock-modal-title">{t('whatif.hypoSellModalStockTitle')}</h2>
                        <button
                          type="button"
                          className="modalCloseBtn"
                          aria-label={t('modals.close')}
                          onClick={() => setHypoSellStockModalOpen(false)}
                        >
                          ✕
                        </button>
                      </header>
                      <div className="modalBody">
                        <label className="modalLabel">
                          {t('modals.asset')}
                          <select
                            className="modalSelect"
                            value={(() => {
                              const sym = normalizeText(stockSellForm.selectedSymbol).toUpperCase();
                              if (!sym) return '';
                              return stockSellHoldingsOptions.some(
                                (r) => String(r.symbol || '').toUpperCase() === sym,
                              )
                                ? sym
                                : '';
                            })()}
                            onChange={(e) => {
                              const sym = normalizeText(e.target.value).toUpperCase();
                              if (!sym) {
                                setStockSellForm((prev) => ({
                                  ...prev,
                                  selectedSymbol: '',
                                  qty: '',
                                  sellPrice: '',
                                  sellPct: 0,
                                }));
                                return;
                              }
                              const avail = sellFormAvailableQtyForSymbol(sym);
                              const priceStr = marketPriceDefaultStringForSymbol(portfolioTableRows, sym);
                              setStockSellForm((prev) => ({
                                ...prev,
                                selectedSymbol: sym,
                                sellPct: 0,
                                qty: '',
                                sellPrice: priceStr,
                              }));
                            }}
                          >
                            <option value="">{t('whatif.sellSelectHoldingPlaceholder')}</option>
                            {stockSellHoldingsOptions.map((row) => {
                              const sym = String(row.symbol || '').toUpperCase();
                              const labelName = row.name && String(row.name) !== sym ? String(row.name) : '';
                              return (
                                <option key={sym} value={sym}>
                                  {labelName ? `${sym} — ${labelName}` : sym} ({formatQty(num(row.qty))})
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        {stockSellHoldingsOptions.length === 0 ? (
                          <p className="modalHint">{t('whatif.sellNoHoldingsWithQty')}</p>
                        ) : null}
                        {normalizeText(stockSellForm.selectedSymbol) ? (
                          <p className="modalHint">
                            {t('whatif.holdingQtyForSalesHint', {
                              qty: formatQty(livePortfolioQtyForSymbol(stockSellForm.selectedSymbol)),
                            })}
                          </p>
                        ) : null}
                        <div className="modalGrid">
                          <label className="modalLabel">
                            {t('modals.quantity')}
                            {(() => {
                              const sym = normalizeText(stockSellForm.selectedSymbol).toUpperCase();
                              if (!sym) return null;
                              const holding = livePortfolioQtyForSymbol(sym);
                              const buys = hypotheticalBuyQtyForSymbol(sym);
                              const sells = hypotheticalSellQtyCommittedForSymbol(sym);
                              return (
                                <span className="modalHint" style={{ marginTop: 4 }}>
                                  {hideValues
                                    ? '(Holding: — + Simulated buy: — - Simulated sell: —)'
                                    : `(Holding: ${formatQty(holding)} + Simulated buy: ${formatQty(buys)} - Simulated sell: ${formatQty(sells)})`}
                                </span>
                              );
                            })()}
                            <input
                              ref={stockSellQtyRef}
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={stockSellForm.qty}
                              onChange={handleStockSellQtyChange}
                              disabled={!(sellFormAvailableQtyForSymbol(stockSellForm.selectedSymbol) > 0)}
                              placeholder={
                                (() => {
                                  const avail = sellFormAvailableQtyForSymbol(stockSellForm.selectedSymbol);
                                  if (!(avail > 0)) return '0';
                                  return `≤ ${formatQty(avail)}`;
                                })()
                              }
                            />
                          </label>
                          <label className="modalLabel">
                            {t('modals.sellPct')}
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="0.1"
                              value={stockSellForm.sellPct}
                              onChange={handleStockSellPctChange}
                              className="modalRange"
                              disabled={!(sellFormAvailableQtyForSymbol(stockSellForm.selectedSymbol) > 0)}
                            />
                            <div className="modalRangeMeta">
                              <strong>
                                {Number.isFinite(stockSellForm.sellPct)
                                  ? `${Number(stockSellForm.sellPct).toFixed(1)}%`
                                  : '0.0%'}
                              </strong>
                              <span>
                                {t('modals.qtyShort')} {stockSellForm.qty || '0'}
                              </span>
                            </div>
                          </label>
                          <label className="modalLabel whatIfHypoSellModalGridFull">
                            {t('whatif.sellPricePerUnit')}
                            <input
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={stockSellForm.sellPrice}
                              onChange={(e) =>
                                setStockSellForm((prev) => ({
                                  ...prev,
                                  sellPrice: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                                }))
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <footer className="modalFooter whatIfHypoBuyModalFooter">
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => setHypoSellStockModalOpen(false)}
                        >
                          {t('modals.cancel')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => {
                            resetStockSellForm();
                          }}
                        >
                          {t('whatif.hypoBuyModalClearForm')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn"
                          onClick={() => {
                            if (addStockHypotheticalSellToList()) setHypoSellStockModalOpen(false);
                          }}
                        >
                          {t('whatif.addHypotheticalSellToList')}
                        </button>
                      </footer>
                    </section>
                  </div>
                )}

                {hypoSellCryptoModalOpen && (
                  <div
                    className="modalOverlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="hypo-sell-crypto-modal-title"
                  >
                    <section className="modalCard whatIfHypoSellModalCard">
                      <header className="modalHeader">
                        <h2 id="hypo-sell-crypto-modal-title">{t('whatif.hypoSellModalCryptoTitle')}</h2>
                        <button
                          type="button"
                          className="modalCloseBtn"
                          aria-label={t('modals.close')}
                          onClick={() => setHypoSellCryptoModalOpen(false)}
                        >
                          ✕
                        </button>
                      </header>
                      <div className="modalBody">
                        <label className="modalLabel">
                          {t('modals.asset')}
                          <select
                            className="modalSelect"
                            value={(() => {
                              const sym = normalizeText(cryptoSellForm.selectedSymbol).toUpperCase();
                              if (!sym) return '';
                              return cryptoSellHoldingsOptions.some(
                                (r) => String(r.symbol || '').toUpperCase() === sym,
                              )
                                ? sym
                                : '';
                            })()}
                            onChange={(e) => {
                              const sym = normalizeText(e.target.value).toUpperCase();
                              if (!sym) {
                                setCryptoSellForm((prev) => ({
                                  ...prev,
                                  selectedSymbol: '',
                                  qty: '',
                                  sellPrice: '',
                                  sellPct: 0,
                                }));
                                return;
                              }
                              const avail = sellFormAvailableQtyForSymbol(sym);
                              const priceStr = marketPriceDefaultStringForSymbol(portfolioTableRows, sym);
                              setCryptoSellForm((prev) => ({
                                ...prev,
                                selectedSymbol: sym,
                                sellPct: 0,
                                qty: '',
                                sellPrice: priceStr,
                              }));
                            }}
                          >
                            <option value="">{t('whatif.sellSelectHoldingPlaceholder')}</option>
                            {cryptoSellHoldingsOptions.map((row) => {
                              const sym = String(row.symbol || '').toUpperCase();
                              const labelName = row.name && String(row.name) !== sym ? String(row.name) : '';
                              return (
                                <option key={sym} value={sym}>
                                  {labelName ? `${sym} — ${labelName}` : sym} ({formatQty(num(row.qty))})
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        {cryptoSellHoldingsOptions.length === 0 ? (
                          <p className="modalHint">{t('whatif.sellNoHoldingsWithQty')}</p>
                        ) : null}
                        {normalizeText(cryptoSellForm.selectedSymbol) ? (
                          <p className="modalHint">
                            {t('whatif.holdingQtyForSalesHint', {
                              qty: formatQty(livePortfolioQtyForSymbol(cryptoSellForm.selectedSymbol)),
                            })}
                          </p>
                        ) : null}
                        <div className="modalGrid">
                          <label className="modalLabel">
                            {t('modals.quantity')}
                            {(() => {
                              const sym = normalizeText(cryptoSellForm.selectedSymbol).toUpperCase();
                              if (!sym) return null;
                              const holding = livePortfolioQtyForSymbol(sym);
                              const buys = hypotheticalBuyQtyForSymbol(sym);
                              const sells = hypotheticalSellQtyCommittedForSymbol(sym);
                              return (
                                <span className="modalHint" style={{ marginTop: 4 }}>
                                  {hideValues
                                    ? '(Holding: — + Simulated buy: — - Simulated sell: —)'
                                    : `(Holding: ${formatQty(holding)} + Simulated buy: ${formatQty(buys)} - Simulated sell: ${formatQty(sells)})`}
                                </span>
                              );
                            })()}
                            <input
                              ref={cryptoSellQtyRef}
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={cryptoSellForm.qty}
                              onChange={handleCryptoSellQtyChange}
                              disabled={!(sellFormAvailableQtyForSymbol(cryptoSellForm.selectedSymbol) > 0)}
                              placeholder={
                                (() => {
                                  const avail = sellFormAvailableQtyForSymbol(cryptoSellForm.selectedSymbol);
                                  if (!(avail > 0)) return '0';
                                  return `≤ ${formatQty(avail)}`;
                                })()
                              }
                            />
                          </label>
                          <label className="modalLabel">
                            {t('modals.sellPct')}
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="0.1"
                              value={cryptoSellForm.sellPct}
                              onChange={handleCryptoSellPctChange}
                              className="modalRange"
                              disabled={!(sellFormAvailableQtyForSymbol(cryptoSellForm.selectedSymbol) > 0)}
                            />
                            <div className="modalRangeMeta">
                              <strong>
                                {Number.isFinite(cryptoSellForm.sellPct)
                                  ? `${Number(cryptoSellForm.sellPct).toFixed(1)}%`
                                  : '0.0%'}
                              </strong>
                              <span>
                                {t('modals.qtyShort')} {cryptoSellForm.qty || '0'}
                              </span>
                            </div>
                          </label>
                          <label className="modalLabel whatIfHypoSellModalGridFull">
                            {t('whatif.sellPricePerUnit')}
                            <input
                              className="modalInput"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={cryptoSellForm.sellPrice}
                              onChange={(e) =>
                                setCryptoSellForm((prev) => ({
                                  ...prev,
                                  sellPrice: sanitizeDecimalInput(e.target.value, { allowNegative: false }),
                                }))
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <footer className="modalFooter whatIfHypoBuyModalFooter">
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => setHypoSellCryptoModalOpen(false)}
                        >
                          {t('modals.cancel')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn secondary"
                          onClick={() => {
                            resetCryptoSellForm();
                          }}
                        >
                          {t('whatif.hypoBuyModalClearForm')}
                        </button>
                        <button
                          type="button"
                          className="modalBtn"
                          onClick={() => {
                            if (addCryptoHypotheticalSellToList()) setHypoSellCryptoModalOpen(false);
                          }}
                        >
                          {t('whatif.addHypotheticalSellToList')}
                        </button>
                      </footer>
                    </section>
                  </div>
                )}

              </>
            )}
          </>
        )}
      </div>
      {showAutosaveStickyBar && (
        <div className="whatIfStickySaveBar" aria-live="polite">
          <div className="whatIfStickySaveBarInner">
            <div className="whatIfStickySaveLeft">
              {isPersistingInputs ? (
                <>
                  <span className="whatIfStickySavedText">{t('whatif.autosaveSaving')}</span>
                  <div
                    className="whatIfStickyProgressTrack"
                    role="progressbar"
                    aria-busy="true"
                    aria-valuetext={t('whatif.autosaveSaving')}
                  >
                    <div className="whatIfStickyProgressIndeterminate" aria-hidden="true" />
                  </div>
                </>
              ) : isDirty ? (
                <span className="whatIfUnsavedPill">{t('whatif.autosaveUnsaved')}</span>
              ) : (
                <span className="whatIfStickySavedText">{t('whatif.autosaveSaved')}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
