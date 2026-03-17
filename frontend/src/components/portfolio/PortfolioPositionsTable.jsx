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
  const [recordPosition, setRecordPosition] = useState(null);
  const [deleteTxConfirm, setDeleteTxConfirm] = useState(null); // { symbol, txId } | null

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
    if (category === 'Stock Assets' || category === 'US Stock Assets') return 'US Stock Assets';
    return category || 'Other';
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

  function requestDeleteTx(symbol, txId) {
    const sym = String(symbol || '').trim().toUpperCase();
    const id = String(txId || '').trim();
    if (!sym || !id) return;
    setDeleteTxConfirm({ symbol: sym, txId: id });
  }

  async function handleDeleteTxConfirmed(symbol, txId) {
    const sym = String(symbol || '').trim().toUpperCase();
    const id = String(txId || '').trim();
    if (!sym || !id) return;
    try {
      await deleteJson(`/api/portfolio/transactions/${encodeURIComponent(id)}`);
      await loadTransactionsFor(sym);
      onRefresh?.();
    } catch (err) {
      window.alert(err?.message || 'Failed to delete transaction.');
    }
  }

  function openRecordPurchase(item) {
    setRecordPosition(item);
    setRecordModalOpen(true);
  }

  const renderExpandedPanel = (item) => (
    <div className="positionTxPanel positionTxPanel--mobile">
      <section className="positionTxSection">
        <div className="positionTxSectionHeader">
          <strong>Initial Holding</strong>
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
                    <span>Quantity</span>
                    <strong>{formatMaybeHidden(hideValues, formatQty, baseQty)}</strong>
                  </div>
                  <div>
                    <span>Avg Cost Per Unit</span>
                    <strong>{formatMaybeHidden(hideValues, formatMoney, baseAvg)}</strong>
                  </div>
                  <div>
                    <span>Cost Basis</span>
                    <strong>{formatMaybeHidden(hideValues, formatMoney, baseCost)}</strong>
                  </div>
                  <div>
                    <span>Market Value</span>
                    <strong>{formatPrice(item, marketValue)}</strong>
                  </div>
                  <div>
                    <span>Unrealized Gain/Loss</span>
                    <strong className={pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, pnl)}</strong>
                  </div>
                  <div>
                    <span>Unrealized Return (%)</span>
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

      <section className="positionTxSection">
        <div className="positionTxSectionHeader">
          <strong>Purchases</strong>
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
        {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>Loading…</p>}
        {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
          <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
        )}
        {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
          <div className="positionTxCards">
            {(txBySymbol.get(String(item.symbol || item.key).toUpperCase()) || []).length === 0 ? (
              <p className="positionTxEmpty">No purchases yet.</p>
            ) : (
              (txBySymbol.get(String(item.symbol || item.key).toUpperCase()) || []).map((tx) => {
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
                        onClick={() => requestDeleteTx(item.symbol || item.key, tx.id)}
                        aria-label="Delete purchase"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="positionTxCardGrid">
                      <div>
                        <span>Quantity</span>
                        <strong>{formatMaybeHidden(hideValues, formatQty, qty)}</strong>
                      </div>
                      <div>
                        <span>Avg Cost Per Unit</span>
                        <strong>{formatMaybeHidden(hideValues, formatMoney, avgCost)}</strong>
                      </div>
                      <div>
                        <span>Cost Basis</span>
                        <strong>{formatMaybeHidden(hideValues, formatMoney, cost)}</strong>
                      </div>
                      <div>
                        <span>Market Value</span>
                        <strong>{formatPrice(item, marketValue)}</strong>
                      </div>
                      <div>
                        <span>Unrealized Gain/Loss</span>
                        <strong className={pnl >= 0 ? 'pos' : 'neg'}>{formatMaybeHidden(hideValues, formatMoney, pnl)}</strong>
                      </div>
                      <div>
                        <span>Unrealized Return (%)</span>
                        <strong className={pnl >= 0 ? 'pos' : 'neg'}>{hideValues ? 'Hidden' : formatPercent(pnlPct)}</strong>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
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
              aria-label="Toggle transactions"
              title={expanded.has(String(item.symbol || item.key).toUpperCase()) ? 'Hide transactions' : 'Show transactions'}
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
              <section className="positionTxSection">
                <div className="positionTxSectionHeader">
                  <strong>Existing Holding</strong>
                </div>
                <div className="tableWrap">
                  <table className="positionTxTable positionHoldingTable">
                    <thead>
                      <tr>
                        <th aria-hidden="true" className="positionTxSpacerCol" />
                        <th>Quantity</th>
                        <th>Avg Cost Per Unit</th>
                        <th>Cost Basis</th>
                        <th>Market Value</th>
                        <th>Unrealized Gain/Loss</th>
                        <th>Unrealized Return (%)</th>
                        <th>Actions</th>
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
                              <td aria-hidden="true" className="positionTxSpacerCol" />
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

              <section className="positionTxSection">
                <div className="positionTxSectionHeader">
                  <strong>Purchases</strong>
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
              {txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && <p>Loading…</p>}
              {txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                <p className="error">{txErrorBySymbol.get(String(item.symbol || item.key).toUpperCase())}</p>
              )}
              {!txLoadingBySymbol.get(String(item.symbol || item.key).toUpperCase()) && (
                <div className="tableWrap">
                  <table className="positionTxTable positionTxTransactionsTable">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Quantity</th>
                        <th>Avg Cost Per Unit</th>
                        <th>Cost Basis</th>
                        <th>Market Value</th>
                        <th>Unrealized Gain/Loss</th>
                        <th>Unrealized Return (%)</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(txBySymbol.get(String(item.symbol || item.key).toUpperCase()) || []).length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ color: '#94a3b8' }}>
                            No transactions yet.
                          </td>
                        </tr>
                      ) : (
                        (txBySymbol.get(String(item.symbol || item.key).toUpperCase()) || []).map((tx) => (
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
                                onClick={() => requestDeleteTx(item.symbol || item.key, tx.id)}
                                aria-label="Delete transaction"
                                title="Delete"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
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
          onRefresh?.();
        }}
      />

      {deleteTxConfirm && (
        <div className="modalOverlay" role="presentation" onMouseDown={() => setDeleteTxConfirm(null)}>
          <div className="modalCard" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Delete purchase?</h2>
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
                          <span>Market Value</span>
                          <strong>{formatPrice(item, item.currentValue)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>Cost Basis</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.totalPurchaseCost)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>Quantity</span>
                          <strong>{formatMaybeHidden(hideValues, formatQty, item.qty)}</strong>
                        </div>
                        <div className="positionQuickItem">
                          <span>Avg Cost</span>
                          <strong>{formatMaybeHidden(hideValues, formatMoney, item.purchasePrice)}</strong>
                        </div>
                      </div>
                      <dl className="positionMetaList">
                        <div className="positionMetaRowWithActions">
                          <div>
                            <dt>Weight</dt>
                            <dd>{formatPercentUnsigned(item.weightPct)}</dd>
                          </div>
                          {(onEditPosition || onDeletePosition) && (
                            <div className="positionCardActionIcons">
                              {onEditPosition && (
                                <button
                                  type="button"
                                  className="headerIconBtn positionActionBtn"
                                  onClick={() => onEditPosition(item)}
                                  aria-label={`Edit ${item.name}`}
                                  title="Edit"
                                >
                                  ✎
                                </button>
                              )}
                              {onDeletePosition && (
                                <button
                                  type="button"
                                  className="headerIconBtn positionActionBtn positionActionBtnDanger"
                                  onClick={() => onDeletePosition(item)}
                                  aria-label={`Delete ${item.name}`}
                                  title="Delete"
                                >
                                  ✕
                                </button>
                              )}
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
