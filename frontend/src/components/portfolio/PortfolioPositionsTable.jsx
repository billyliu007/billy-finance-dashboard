import { useEffect, useMemo, useState } from 'react';
import {
  formatMaybeHidden,
  formatMoney,
  formatPercent,
  formatPercentUnsigned,
  formatQty,
} from '../../utils/formatters.js';
import { useLanguage } from '../../contexts/LanguageContext.jsx';
import { deleteJson, fetchJson } from '../../utils/api.js';
import RecordPurchaseModal from './RecordPurchaseModal.jsx';
import RecordSaleModal from './RecordSaleModal.jsx';
import SalesHistoryDialog from './SalesHistoryDialog.jsx';

export default function PortfolioPositionsTable({
  hideValues,
  rows,
  onAddCrypto,
  onAddStock,
  onEditPosition,
  onDeletePosition,
  cashComponents,
  onRefresh,
}) {
  const { t } = useLanguage();
  const [showMobileDetails] = useState(true);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [txBySymbol, setTxBySymbol] = useState(() => new Map());
  const [txLoadingBySymbol, setTxLoadingBySymbol] = useState(() => new Map());
  const [txErrorBySymbol, setTxErrorBySymbol] = useState(() => new Map());
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [recordPosition, setRecordPosition] = useState(null);
  const [deleteTxConfirm, setDeleteTxConfirm] = useState(null); // { symbol, txId, txType } | null
  const [salesHistoryState, setSalesHistoryState] = useState(() => ({
    open: false,
    symbol: '',
    isCrypto: false,
  }));
  const [historyCountBySymbol, setHistoryCountBySymbol] = useState(() => new Map());

  useEffect(() => {
    const symbols = Array.from(
      new Set(
        (rows || [])
          .map((r) => String(r?.symbol || r?.key || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    if (symbols.length === 0) return;

    let cancelled = false;
    async function loadCounts() {
      // Fire in parallel (small set); errors should not break UI.
      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetchJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/sales-history/count`);
            const count = Number(res?.count) || 0;
            if (cancelled) return;
            setHistoryCountBySymbol((prev) => {
              const next = new Map(prev);
              next.set(sym, count);
              return next;
            });
          } catch {
            // ignore
          }
        }),
      );
    }

    loadCounts();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  useEffect(() => {
    if (!showAddMenu) return;
    function handleClickOutside(event) {
      if (event.target.closest('.addMenuToggle, .addMenuPopover')) return;
      setShowAddMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAddMenu]);

  const groupedRows = useMemo(() => {
    const grouped = new Map();
    rows.forEach((item) => {
      const classKey = item.category || 'Other';
      if (!grouped.has(classKey)) {
        grouped.set(classKey, []);
      }
      grouped.get(classKey).push(item);
    });
    return Array.from(grouped.entries());
  }, [rows]);

  /** Display label for asset class. "Stock Assets" (legacy) → "US Stock Assets"; others shown as-is for future classes. */
  const getAssetClassDisplayLabel = (category) => {
    const raw = String(category || '').trim();
    const normalized = raw.toLowerCase();

    if (normalized.includes('crypto')) return t('portfolio.assetClassCryptoAssets');
    if (normalized.includes('stock')) return t('portfolio.assetClassUSStockAssets');
    return raw || 'Other';
  };

  const tableHeaderRow = (
    <div className="tableHeaderRow">
      <h2>{t('portfolio.positions')}</h2>
      <div className="tableHeaderActions">
        {(onAddStock || onAddCrypto) && (
          <>
            <button
              type="button"
              className="headerIconBtn addMenuToggle"
              onClick={() => setShowAddMenu((prev) => !prev)}
              aria-label={t('portfolio.addPosition')}
              aria-expanded={showAddMenu}
            >
              +
            </button>
            {showAddMenu && (
              <div className="addMenuPopover">
                {onAddStock && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMenu(false);
                      onAddStock();
                    }}
                  >
                    {t('portfolio.stockPosition')}
                  </button>
                )}
                {onAddCrypto && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMenu(false);
                      onAddCrypto();
                    }}
                  >
                    {t('portfolio.cryptoPosition')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const priceUnavailable = (item) => (item.currentPrice === 0 && item.priceSource === 'unavailable');
  const formatPrice = (item, value) =>
    !hideValues && priceUnavailable(item) && value === 0 ? '—' : formatMaybeHidden(hideValues, formatMoney, value);

  async function loadTransactionsFor(symbol) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    setTxLoadingBySymbol((prev) => new Map(prev).set(sym, true));
    setTxErrorBySymbol((prev) => {
      const next = new Map(prev);
      next.delete(sym);
      return next;
    });
    try {
      const res = await fetchJson(`/api/portfolio/positions/${encodeURIComponent(sym)}/transactions`);
      const list = Array.isArray(res?.transactions) ? res.transactions : [];
      setTxBySymbol((prev) => new Map(prev).set(sym, list));
    } catch (err) {
      setTxErrorBySymbol((prev) => new Map(prev).set(sym, err?.message || 'Failed to load transactions.'));
    } finally {
      setTxLoadingBySymbol((prev) => new Map(prev).set(sym, false));
    }
  }

  function toggleExpanded(item) {
    const sym = String(item?.symbol || item?.key || '').trim().toUpperCase();
    if (!sym) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
    if (!txBySymbol.has(sym)) {
      loadTransactionsFor(sym);
    }
  }

  function requestDeleteTx(symbol, txId, txType) {
    const sym = String(symbol || '').trim().toUpperCase();
    const id = String(txId || '').trim();
    if (!sym || !id) return;
    const kind = String(txType || '').trim().toUpperCase() || 'BUY';
    setDeleteTxConfirm({ symbol: sym, txId: id, txType: kind });
  }

  async function handleDeleteTxConfirmed(symbol, txId) {
    const sym = String(symbol || '').trim().toUpperCase();
    const id = String(txId || '').trim();
    if (!sym || !id) return;
    try {
      await deleteJson(`/api/portfolio/transactions/${encodeURIComponent(id)}`);
      await loadTransactionsFor(sym);
      onRefresh?.({ mode: 'silent' });
    } catch (err) {
      window.alert(err?.message || 'Failed to delete purchase.');
    }
  }

  function openRecordPurchase(item) {
    setRecordPosition(item);
    setRecordModalOpen(true);
  }

  function openRecordSale(item) {
    setRecordPosition(item);
    setSaleModalOpen(true);
  }

  function openSalesHistory(item) {
    const sym = String(item?.symbol || item?.key || '').trim().toUpperCase();
    if (!sym) return;
    const isCrypto = /crypto/i.test(String(item?.category || ''));
    setSalesHistoryState({ open: true, symbol: sym, isCrypto });
  }

  function historyCountFor(item) {
    const sym = String(item?.symbol || item?.key || '').trim().toUpperCase();
    return Number(historyCountBySymbol.get(sym) || 0);
  }

  function getTxType(tx) {
    const raw = String(tx?.type || '').trim().toUpperCase();
    return raw === 'SELL' ? 'SELL' : 'BUY';
  }

  function splitTxForItem(item) {
    const sym = String(item.symbol || item.key).toUpperCase();
    const list = txBySymbol.get(sym) || [];
    const buys = [];
    const sells = [];
    for (const tx of list) {
      if (getTxType(tx) === 'SELL') sells.push(tx);
      else buys.push(tx);
    }
    return { buys, sells };
  }

  const renderExpandedPanel = (item) => (
    <div className="positionTxPanel positionTxPanel--mobile">
      <section className="positionTxSection positionTxSection--base">
        <div className="positionTxSectionHeader">
          <strong>{t('portfolio.initialHolding')}</strong>
        </div>
        {(() => {
          const baseQty = Number(item.baseQty ?? 0);
          const baseAvg = Number(item.baseAvgCost ?? 0);
          const baseCost = Number(item.baseCost ?? baseQty * baseAvg) || 0;
          const price = Number(item.currentPrice ?? 0);
          const marketValue = baseQty * price;
          const pnl = marketValue - baseCost;
          const pnlPct = baseCost === 0 ? 0 : (pnl / baseCost) * 100;
          return (
            <div className="positionTxCards">
              <div className="positionTxCard">
                <div className="positionTxCardGrid">
                  <div>
                    <span>{t('portfolio.quantity')}</span>
                    <strong>{formatMaybeHidden(hideValues, formatQty, baseQty)}</strong>
                  </div>
                  <div>
                    <span>{t('portfolio.avgCostPerUnit')}</span>
                    <strong>{formatMaybeHidden(hideValues, formatMoney, baseAvg)}</strong>
                  </div>
                  <div>
                    <span>{t('portfolio.costBasis')}</span>
                    <strong>{formatMaybeHidden(hideValues, formatMoney, baseCost)}</strong>
                  </div>
                  <div>
                    <span>{t('portfolio.marketValue')}</span>
                    <strong>{formatPrice(item, marketValue)}</strong>
                  </div>
                  <div>
                    <span>{t('portfolio.unrealizedGainLoss')}</span>
                    <strong className={pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, pnl)}</strong>
                  </div>
                  <div>
                    <span>{t('portfolio.unrealizedReturn')}</span>
                    <strong className={pnl >= 0 ? 'pos' : 'neg'}>{hideValues ? 'Hidden' : formatPercent(pnlPct)}</strong>
                  </div>
                </div>
                <div className="positionTxCardActions">
                  {onEditPosition && (
                    <button
                      type="button"
                      className="headerIconBtn positionActionBtn"
                      onClick={() =>
                        onEditPosition({
                          ...item,
                          qty: Number(item.baseQty ?? 0),
                          purchasePrice: Number(item.baseAvgCost ?? 0),
                        })
                      }
                      aria-label={`${t('portfolio.edit')} ${item.name}`}
                      title={t('portfolio.edit')}
                    >
                      ✎
                    </button>
                  )}
                  {onDeletePosition && (
                    <button
                      type="button"
                      className="headerIconBtn positionActionBtn positionActionBtnDanger"
                      onClick={() => onDeletePosition(item)}
                      aria-label={`${t('portfolio.delete')} ${item.name}`}
                      title={t('portfolio.delete')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      <section className="positionTxSection positionTxSection--purchases">
        <div className="positionTxSectionHeader">
          <strong>{t('portfolio.purchases')}</strong>
          <button
            type="button"
            className="headerIconBtn positionActionBtn"
            onClick={() => openRecordPurchase(item)}
            aria-label="Add New Transaction"
            title="Add New Transaction"
          >
            +
          </button>
        </div>
        {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>{t('app.loading')}</p>}
        {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
          <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
        )}
        {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
          <div className="positionTxCards">
            {(() => {
              const { buys } = splitTxForItem(item);
              return buys.length === 0 ? (
              <p className="positionTxEmpty">{t('portfolio.noPurchasesYet')}</p>
              ) : (
              buys.map((tx) => {
                const qty = Number(tx.qty) || 0;
                const avgCost = Number(tx.avgCostPerUnit) || 0;
                const cost = qty * avgCost;
                const price = Number(item.currentPrice ?? 0);
                const marketValue = qty * price;
                const pnl = marketValue - cost;
                const pnlPct = cost === 0 ? 0 : (pnl / cost) * 100;
                return (
                  <div key={tx.id} className="positionTxCard">
                    <div className="positionTxCardTitleRow">
                      <strong>{tx.txDate}</strong>
                      <button
                        type="button"
                        className="headerIconBtn positionActionBtn positionActionBtnDanger"
                        onClick={() => requestDeleteTx(item.symbol || item.key, tx.id, tx.type)}
                        aria-label="Delete purchase"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="positionTxCardGrid">
                      <div>
                        <span>{t('portfolio.quantity')}</span>
                        <strong>{formatMaybeHidden(hideValues, formatQty, qty)}</strong>
                      </div>
                      <div>
                        <span>{t('portfolio.avgCostPerUnit')}</span>
                        <strong>{formatMaybeHidden(hideValues, formatMoney, avgCost)}</strong>
                      </div>
                      <div>
                        <span>{t('portfolio.costBasis')}</span>
                        <strong>{formatMaybeHidden(hideValues, formatMoney, cost)}</strong>
                      </div>
                      <div>
                        <span>{t('portfolio.marketValue')}</span>
                        <strong>{formatPrice(item, marketValue)}</strong>
                      </div>
                      <div>
                        <span>{t('portfolio.unrealizedGainLoss')}</span>
                        <strong className={pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, pnl)}</strong>
                      </div>
                      <div>
                        <span>{t('portfolio.unrealizedReturn')}</span>
                        <strong className={pnl >= 0 ? 'pos' : 'neg'}>{hideValues ? 'Hidden' : formatPercent(pnlPct)}</strong>
                      </div>
                    </div>
                  </div>
                );
              })
              );
            })()}
          </div>
        )}
      </section>

      <section className="positionTxSection positionTxSection--sold">
        <div className="positionTxSectionHeader">
          <strong>
            {t('portfolio.sold')}
            {historyCountFor(item) > 0 && (
              <span className="positionTxHint" title={t('portfolio.realizedPlIncludesImportedHistoryTitle')}>
                + {t('portfolio.history')}
              </span>
            )}
          </strong>
          <button
            type="button"
            className="headerIconBtn positionActionBtn"
            onClick={() => openSalesHistory(item)}
            aria-label={t('portfolio.showSoldHistory')}
            title={t('portfolio.showSoldHistory')}
            style={{ marginLeft: 'auto' }}
          >
            <span className="positionTxIconWithBadge">
              ☰
              {historyCountFor(item) > 0 && <span className="positionTxBadge">{historyCountFor(item)}</span>}
            </span>
          </button>
          <button
            type="button"
            className="headerIconBtn positionActionBtn"
            onClick={() => openRecordSale(item)}
            aria-label={t('portfolio.addSale')}
            title={t('portfolio.addSale')}
          >
            +
          </button>
        </div>
        {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>{t('app.loading')}</p>}
        {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
          <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
        )}
        {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
          <div className="positionTxCards">
            {(() => {
              const { sells } = splitTxForItem(item);
              return sells.length === 0 ? (
                <p className="positionTxEmpty">{t('portfolio.noSalesYet')}</p>
              ) : (
                sells.map((tx) => {
                  const qty = Number(tx.qty) || 0;
                  const sellPrice = Number(tx.avgCostPerUnit) || 0;
                  const feeFlat = Number(tx.feeFlat) || 0;
                  const proceeds = qty * sellPrice - feeFlat;
                  const basisPerUnit = Number(tx.costBasisPerUnit) || 0;
                  const costSold = qty * basisPerUnit;
                  const realized = proceeds - costSold;
                  const realizedPct = costSold === 0 ? 0 : (realized / costSold) * 100;
                  return (
                    <div key={tx.id} className="positionTxCard">
                      <div className="positionTxCardTitleRow">
                        <strong>{tx.txDate}</strong>
                        <button
                          type="button"
                          className="headerIconBtn positionActionBtn positionActionBtnDanger"
                          onClick={() => requestDeleteTx(item.symbol || item.key, tx.id, tx.type)}
                          aria-label="Delete sale"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="positionTxCardGrid">
                        <div>
                          <span>{t('portfolio.quantity')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatQty, qty)}</strong>
                        </div>
                        <div>
                          <span>{t('modals.historyTableSellPrice')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, sellPrice)}</strong>
                        </div>
                        <div>
                          <span>{t('modals.historyTableCostPerUnit')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, basisPerUnit)}</strong>
                        </div>
                        <div>
                          <span>{t('modals.historyTableSaleAmount')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, proceeds)}</strong>
                        </div>
                        <div>
                          <span>{t('modals.historyTableRealizedPl')}</span>
                          <strong className={realized >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, realized)}</strong>
                        </div>
                        <div>
                          <span>{t('modals.historyTableRealizedReturn')}</span>
                          <strong className={realized >= 0 ? 'pos' : 'neg'}>{hideValues ? 'Hidden' : formatPercent(realizedPct)}</strong>
                        </div>
                      </div>
                    </div>
                  );
                })
              );
            })()}
          </div>
        )}
      </section>
    </div>
  );

  const renderPositionRow = (item) => (
    <>
      <tr key={item.key}>
        <td data-label={t('portfolio.asset')}>
          <div className="positionAssetCell">
            <button
              type="button"
              className="headerIconBtn positionExpandBtn"
              onClick={() => toggleExpanded(item)}
              aria-label="Toggle purchases"
              title={expanded.has(String(item.symbol || item.key).toUpperCase()) ? 'Hide purchases' : 'Show purchases'}
            >
              {expanded.has(String(item.symbol || item.key).toUpperCase()) ? '▾' : '▸'}
            </button>
            <span className="positionAssetName">{item.name}</span>
          </div>
        </td>
      <td data-label={t('portfolio.currency')}>{item.currency || 'USD'}</td>
      <td data-label={t('portfolio.quantity')}>{formatMaybeHidden(hideValues, formatQty, item.qty)}</td>
      <td data-label={t('portfolio.avgCostPerUnit')}>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</td>
      <td data-label={t('portfolio.costBasis')}>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</td>
      <td data-label={t('portfolio.marketPrice')}>{formatPrice(item, item.currentPrice)}</td>
      <td data-label={t('portfolio.marketValue')}>{formatPrice(item, item.currentValue)}</td>
      <td data-label={t('portfolio.portfolioWeight')}>{formatPercentUnsigned(item.weightPct)}</td>
      <td data-label={t('portfolio.unrealizedGainLoss')} className={item.pnl >= 0 ? 'pos' : 'neg'}>
        {formatMaybeHidden(hideValues, formatMoney, item.pnl)}
      </td>
      <td data-label={t('portfolio.unrealizedReturn')} className={item.pnl >= 0 ? 'pos' : 'neg'}>
        {formatPercent(item.pnlPct)}
      </td>
      {(onEditPosition || onDeletePosition) && (
        <td data-label={t('netWorth.actions')} className="positionActionsCell">
          {onDeletePosition && (
            <button
              type="button"
              className="headerIconBtn positionActionBtn positionActionBtnDanger"
              onClick={() => onDeletePosition(item)}
              aria-label={`${t('portfolio.delete')} ${item.name}`}
              title={t('portfolio.delete')}
            >
              ✕
            </button>
          )}
          </td>
      )}
      </tr>
      {expanded.has(String(item.symbol || item.key).toUpperCase()) && (
        <tr className="positionTxRow">
          <td colSpan={(onEditPosition || onDeletePosition) ? 11 : 10}>
            <div className="positionTxPanel">
              <section className="positionTxSection positionTxSection--base">
                <div className="positionTxSectionHeader">
                  <strong>{t('portfolio.initialHolding')}</strong>
                </div>
                <div className="tableWrap">
                  <table className="positionTxTable positionHoldingTable positionTxAlignedTable">
                    <thead>
                      <tr>
                        <th aria-hidden="true" className="positionTxColDate" />
                        <th>{t('portfolio.quantity')}</th>
                        <th>{t('portfolio.avgCostPerUnit')}</th>
                        <th>{t('portfolio.costBasis')}</th>
                        <th>{t('portfolio.marketValue')}</th>
                        <th>{t('portfolio.unrealizedGainLoss')}</th>
                        <th>{t('portfolio.unrealizedReturn')}</th>
                        <th>{t('netWorth.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {(() => {
                          const baseQty = Number(item.baseQty ?? 0);
                          const baseAvg = Number(item.baseAvgCost ?? 0);
                          const baseCost = Number(item.baseCost ?? baseQty * baseAvg) || 0;
                          const price = Number(item.currentPrice ?? 0);
                          const marketValue = baseQty * price;
                          const pnl = marketValue - baseCost;
                          const pnlPct = baseCost === 0 ? 0 : (pnl / baseCost) * 100;
                          return (
                            <>
                              <td aria-hidden="true" className="positionTxColDate" />
                              <td>{formatMaybeHidden(hideValues, formatQty, baseQty)}</td>
                              <td>{formatMaybeHidden(hideValues, formatMoney, baseAvg)}</td>
                              <td>{formatMaybeHidden(hideValues, formatMoney, baseCost)}</td>
                              <td>{formatPrice(item, marketValue)}</td>
                              <td className={pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, pnl)}</td>
                              <td className={pnl >= 0 ? 'pos' : 'neg'}>{hideValues ? 'Hidden' : formatPercent(pnlPct)}</td>
                              <td>
                                <div className="positionInlineActions">
                                {onEditPosition && (
                                  <button
                                    type="button"
                                    className="headerIconBtn positionActionBtn"
                                    onClick={() =>
                                      onEditPosition({
                                        ...item,
                                        qty: Number(item.baseQty ?? 0),
                                        purchasePrice: Number(item.baseAvgCost ?? 0),
                                      })
                                    }
                                    aria-label={`${t('portfolio.edit')} ${item.name}`}
                                    title={t('portfolio.edit')}
                                  >
                                    ✎
                                  </button>
                                )}
                                {onDeletePosition && (
                                  <button
                                    type="button"
                                    className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                    onClick={() => onDeletePosition(item)}
                                    aria-label={`${t('portfolio.delete')} ${item.name}`}
                                    title={t('portfolio.delete')}
                                  >
                                    ✕
                                  </button>
                                )}
                                </div>
                              </td>
                            </>
                          );
                        })()}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="positionTxSection positionTxSection--purchases">
                <div className="positionTxSectionHeader">
                  <strong>{t('portfolio.purchases')}</strong>
                  <button
                    type="button"
                    className="headerIconBtn positionActionBtn"
                    onClick={() => openRecordPurchase(item)}
                    aria-label="Add New Transaction"
                    title="Add New Transaction"
                  >
                    +
                  </button>
                </div>
              {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>{t('app.loading')}</p>}
              {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
              )}
              {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                <div className="tableWrap">
                  <table className="positionTxTable positionTxTransactionsTable positionTxAlignedTable">
                    <thead>
                      <tr>
                        <th className="positionTxColDate">{t('modals.historyTableDate')}</th>
                        <th>{t('portfolio.quantity')}</th>
                        <th>{t('portfolio.avgCostPerUnit')}</th>
                        <th>{t('portfolio.costBasis')}</th>
                        <th>{t('portfolio.marketValue')}</th>
                        <th>{t('portfolio.unrealizedGainLoss')}</th>
                        <th>{t('portfolio.unrealizedReturn')}</th>
                        <th>{t('netWorth.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const { buys } = splitTxForItem(item);
                        return buys.length === 0 ? (
                        <tr>
                            <td colSpan={8} style={{ color: '#94a3b8' }}>
                            {t('portfolio.noPurchasesYet')}
                          </td>
                        </tr>
                        ) : (
                        buys.map((tx) => (
                          <tr key={tx.id}>
                            <td>{tx.txDate}</td>
                            <td>{formatMaybeHidden(hideValues, formatQty, tx.qty)}</td>
                            <td>{formatMaybeHidden(hideValues, formatMoney, tx.avgCostPerUnit)}</td>
                            {(() => {
                              const qty = Number(tx.qty) || 0;
                              const avgCost = Number(tx.avgCostPerUnit) || 0;
                              const cost = qty * avgCost;
                              const price = Number(item.currentPrice ?? 0);
                              const marketValue = qty * price;
                              const pnl = marketValue - cost;
                              const pnlPct = cost === 0 ? 0 : (pnl / cost) * 100;
                              return (
                                <>
                                  <td>{formatMaybeHidden(hideValues, formatMoney, cost)}</td>
                                  <td>{formatPrice(item, marketValue)}</td>
                                  <td className={pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, pnl)}</td>
                                  <td className={pnl >= 0 ? 'pos' : 'neg'}>{hideValues ? 'Hidden' : formatPercent(pnlPct)}</td>
                                </>
                              );
                            })()}
                            <td>
                              <button
                                type="button"
                                className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                onClick={() => requestDeleteTx(item.symbol || item.key, tx.id, tx.type)}
                                aria-label="Delete purchase"
                                title="Delete"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
              </section>

              <section className="positionTxSection positionTxSection--sold">
                <div className="positionTxSectionHeader">
                  <strong>
                    {t('portfolio.sold')}
                    {historyCountFor(item) > 0 && (
                      <span className="positionTxHint" title={t('portfolio.realizedPlIncludesImportedHistoryTitle')}>
                        + {t('portfolio.history')}
                      </span>
                    )}
                  </strong>
                  <button
                    type="button"
                    className="headerIconBtn positionActionBtn"
                    onClick={() => openSalesHistory(item)}
                    aria-label={t('portfolio.showSoldHistory')}
                    title={t('portfolio.showSoldHistory')}
                    style={{ marginLeft: 'auto' }}
                  >
                    <span className="positionTxIconWithBadge">
                      ☰
                      {historyCountFor(item) > 0 && <span className="positionTxBadge">{historyCountFor(item)}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="headerIconBtn positionActionBtn"
                    onClick={() => openRecordSale(item)}
                    aria-label={t('portfolio.addSale')}
                    title={t('portfolio.addSale')}
                  >
                    +
                  </button>
                </div>
                {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>{t('app.loading')}</p>}
                {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                  <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
                )}
                {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                  <div className="tableWrap">
                    <table className="positionTxTable positionTxTransactionsTable positionTxAlignedTable">
                      <thead>
                        <tr>
                          <th className="positionTxColDate">{t('modals.historyTableDate')}</th>
                          <th>{t('modals.historyTableQty')}</th>
                          <th>{t('modals.historyTableSellPrice')}</th>
                          <th>{t('modals.historyTableCostPerUnit')}</th>
                          <th>{t('modals.historyTableSaleAmount')}</th>
                          <th>{t('modals.historyTableRealizedPl')}</th>
                          <th>{t('modals.historyTableRealizedReturn')}</th>
                          <th>{t('netWorth.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const { sells } = splitTxForItem(item);
                          return sells.length === 0 ? (
                            <tr>
                              <td colSpan={8} style={{ color: '#94a3b8' }}>
                                {t('portfolio.noSalesYet')}
                              </td>
                            </tr>
                          ) : (
                            sells.map((tx) => {
                              const qty = Number(tx.qty) || 0;
                              const sellPrice = Number(tx.avgCostPerUnit) || 0;
                              const feeFlat = Number(tx.feeFlat) || 0;
                              const proceeds = qty * sellPrice - feeFlat;
                              const basisPerUnit = Number(tx.costBasisPerUnit) || 0;
                              const costSold = qty * basisPerUnit;
                              const realized = proceeds - costSold;
                              const realizedPct = costSold === 0 ? 0 : (realized / costSold) * 100;
                              return (
                                <tr key={tx.id}>
                                  <td>{tx.txDate}</td>
                                  <td>{formatMaybeHidden(hideValues, formatQty, qty)}</td>
                                  <td>{formatMaybeHidden(hideValues, formatMoney, sellPrice)}</td>
                                  <td>{formatMaybeHidden(hideValues, formatMoney, basisPerUnit)}</td>
                                  <td>{formatMaybeHidden(hideValues, formatMoney, proceeds)}</td>
                                  <td className={realized >= 0 ? 'pos' : 'neg'}>
                                    {formatMaybeHidden(hideValues, formatMoney, realized)}
                                  </td>
                                  <td className={realized >= 0 ? 'pos' : 'neg'}>
                                    {hideValues ? 'Hidden' : formatPercent(realizedPct)}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                      onClick={() => requestDeleteTx(item.symbol || item.key, tx.id, tx.type)}
                                      aria-label="Delete sale"
                                      title="Delete"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </td>
        </tr>
      )}
    </>
  );

  return (
    <>
      <article className="tableCard portfolioPositionsCard">
        {tableHeaderRow}
        <div className="portfolioDesktopTables">
          {groupedRows.map(([assetClass, classRows]) => (
            <section key={`desktop-${assetClass}`} className="portfolioAssetClassTable">
              <h3 className="assetClassTableTitle">{getAssetClassDisplayLabel(assetClass)}</h3>
              <div className="tableWrap">
                <table className="positionsMobileCompact positionsDesktopByClass">
                  <thead>
                    <tr>
                      <th>{t('portfolio.asset')}</th>
                      <th>{t('portfolio.currency')}</th>
                      <th>{t('portfolio.quantity')}</th>
                      <th>{t('portfolio.avgCostPerUnit')}</th>
                      <th>{t('portfolio.costBasis')}</th>
                      <th>{t('portfolio.marketPrice')}</th>
                      <th>{t('portfolio.marketValue')}</th>
                      <th>{t('portfolio.portfolioWeight')}</th>
                      <th>{t('portfolio.unrealizedGainLoss')}</th>
                      <th>{t('portfolio.unrealizedReturn')}</th>
                      {(onEditPosition || onDeletePosition) && <th className="positionActionsHeader">{t('netWorth.actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {classRows.map(renderPositionRow)}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </article>

      <RecordPurchaseModal
        open={recordModalOpen}
        position={recordPosition}
        cashComponents={cashComponents}
        onClose={() => setRecordModalOpen(false)}
        onSaved={async () => {
          if (recordPosition?.symbol) {
            await loadTransactionsFor(recordPosition.symbol);
          }
          onRefresh?.({ mode: 'silent' });
        }}
      />

      <RecordSaleModal
        open={saleModalOpen}
        position={recordPosition}
        cashComponents={cashComponents}
        onClose={() => setSaleModalOpen(false)}
        onSaved={async () => {
          if (recordPosition?.symbol) {
            await loadTransactionsFor(recordPosition.symbol);
          }
          onRefresh?.({ mode: 'silent' });
        }}
      />

      <SalesHistoryDialog
        open={salesHistoryState.open}
        symbol={salesHistoryState.symbol}
        isCrypto={salesHistoryState.isCrypto}
        hideValues={hideValues}
        onHistoryCountChange={(sym, count) => {
          setHistoryCountBySymbol((prev) => {
            const next = new Map(prev);
            next.set(String(sym || '').toUpperCase(), Number(count) || 0);
            return next;
          });
        }}
        onClose={() => setSalesHistoryState((prev) => ({ ...prev, open: false }))}
      />

      {deleteTxConfirm && (
        <div className="modalOverlay" role="presentation" onMouseDown={() => setDeleteTxConfirm(null)}>
          <div className="modalCard" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>{deleteTxConfirm?.txType === 'SELL' ? 'Delete sale?' : 'Delete purchase?'}</h2>
              <button type="button" className="modalCloseBtn" onClick={() => setDeleteTxConfirm(null)}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <p className="modalHint">This cannot be undone.</p>
            </div>
            <div className="modalFooter">
              <button type="button" className="modalBtn secondary" onClick={() => setDeleteTxConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="modalBtn danger"
                onClick={async () => {
                  const sym = deleteTxConfirm.symbol;
                  const id = deleteTxConfirm.txId;
                  setDeleteTxConfirm(null);
                  await handleDeleteTxConfirmed(sym, id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <article className="tableCard portfolioMobileDetailsCard">
        <div className="detailsHeaderRow">
          <h2>{t('portfolio.positions')}</h2>
          <div className="detailsHeaderActions">
            {(onAddStock || onAddCrypto) && (
              <>
                <button
                  type="button"
                  className="headerIconBtn addMenuToggle"
                  onClick={() => setShowAddMenu((prev) => !prev)}
                  aria-label={t('portfolio.addPosition')}
                  aria-expanded={showAddMenu}
                >
                  +
                </button>
                {showAddMenu && (
                  <div className="addMenuPopover">
                    {onAddStock && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddMenu(false);
                          onAddStock();
                        }}
                      >
                        {t('portfolio.stockPosition')}
                      </button>
                    )}
                    {onAddCrypto && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddMenu(false);
                          onAddCrypto();
                        }}
                      >
                        {t('portfolio.cryptoPosition')}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {showMobileDetails && (
          <div className="positionCardStack">
            {groupedRows.map(([assetClass, classRows]) => (
              <section key={`group-${assetClass}`} className="positionClassGroup">
                <header className="positionClassHeader">
                  <h3>{getAssetClassDisplayLabel(assetClass)}</h3>
                  <span>{classRows.length} holdings</span>
                </header>
                <div className="positionClassCards">
                  {classRows.map((item) => (
                    <section key={`mobile-${item.key}`} className="positionDetailCard">
                      <header>
                        <div className="positionNameCol">
                          <div className="positionMobileTitleRow">
                            <button
                              type="button"
                              className="headerIconBtn positionExpandBtn"
                              onClick={() => toggleExpanded(item)}
                              aria-label="Toggle purchases"
                              title={expanded.has(String(item.symbol || item.key).toUpperCase()) ? 'Hide purchases' : 'Show purchases'}
                            >
                              {expanded.has(String(item.symbol || item.key).toUpperCase()) ? '▾' : '▸'}
                            </button>
                          <h3>{item.name}</h3>
                          </div>
                          <span className="positionMarketMeta">
                            {item.currency || 'USD'} · Mkt {formatPrice(item, item.currentPrice)}
                          </span>
                        </div>
                        <div className={`positionPnlDock ${item.pnl >= 0 ? 'pos' : 'neg'}`}>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.pnl)}</strong>
                          <span>{formatMaybeHidden(hideValues, formatPercent, item.pnlPct)}</span>
                        </div>
                      </header>
                      <div className="positionQuickGrid">
                        <div className="positionQuickItem">
                          <span>{t('portfolio.marketValue')}</span>
                          <strong>{formatPrice(item, item.currentValue)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>{t('portfolio.costBasis')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>{t('portfolio.quantity')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatQty, item.qty)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>{t('portfolio.avgCostPerUnit')}</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</strong>
                        </div>
                      </div>
                      <dl className="positionMetaList">
                        <div className="positionMetaRowWithActions">
                          <div>
                            <dt>{t('portfolio.portfolioWeight')}</dt>
                            <dd>{formatPercentUnsigned(item.weightPct)}</dd>
                          </div>
                          {onDeletePosition && (
                            <div className="positionCardActionIcons">
                              <button
                                type="button"
                                className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                onClick={() => onDeletePosition(item)}
                                aria-label={`Delete ${item.name}`}
                                title="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      </dl>
                      {expanded.has(String(item.symbol || item.key).toUpperCase()) && (
                        <div className="positionCardExpandedWrap">
                          {renderExpandedPanel(item)}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </article>
    </>
  );
}
